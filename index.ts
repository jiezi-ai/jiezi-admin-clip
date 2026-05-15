#!/usr/bin/env bun
import { Clip, command, commandGroup, handler, z } from "@pinixai/core";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".config", "jiezi-admin");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

interface Config {
  jiezi_api_url: string;
  jiezi_admin_token: string;
  newapi_url: string;
  newapi_admin_user: string;
  newapi_admin_pass: string;
}

const DEFAULTS: Partial<Config> = {
  jiezi_api_url: "https://api.jiezi.ai",
  newapi_url: "http://43.138.244.147:3000",
};

const CONFIG_KEYS: Record<keyof Config, string> = {
  jiezi_api_url: "解字 API 地址",
  jiezi_admin_token: "解字管理后台 Token",
  newapi_url: "New API 地址",
  newapi_admin_user: "New API 管理员用户名",
  newapi_admin_pass: "New API 管理员密码",
};

function loadConfig(): Partial<Config> {
  if (!existsSync(CONFIG_PATH)) return {};
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function saveConfig(cfg: Partial<Config>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

function getConfig(): Config {
  const stored = loadConfig();
  const cfg: Config = {
    jiezi_api_url: stored.jiezi_api_url || DEFAULTS.jiezi_api_url || "",
    jiezi_admin_token: stored.jiezi_admin_token || "",
    newapi_url: stored.newapi_url || DEFAULTS.newapi_url || "",
    newapi_admin_user: stored.newapi_admin_user || "",
    newapi_admin_pass: stored.newapi_admin_pass || "",
  };
  const missing = (Object.keys(CONFIG_KEYS) as (keyof Config)[]).filter(
    (k) => !cfg[k] && !DEFAULTS[k],
  );
  if (missing.length > 0) {
    throw new Error(
      `配置缺失：${missing.map((k) => `${k} (${CONFIG_KEYS[k]})`).join(", ")}。请先运行 config set 命令配置。`,
    );
  }
  return cfg;
}

async function jieziApi(path: string) {
  const cfg = getConfig();
  const res = await fetch(`${cfg.jiezi_api_url}${path}`, {
    headers: { Authorization: `Bearer ${cfg.jiezi_admin_token}` },
  });
  return res.json();
}

async function newApiSession(): Promise<string> {
  const cfg = getConfig();
  const res = await fetch(`${cfg.newapi_url}/api/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: cfg.newapi_admin_user, password: cfg.newapi_admin_pass }),
  });
  const data = await res.json() as any;
  if (!data.success) throw new Error(`New API login failed: ${data.message}`);
  return res.headers.get("set-cookie")?.split(";")[0] || "";
}

async function newApi(path: string, options: RequestInit = {}) {
  const cfg = getConfig();
  const cookie = await newApiSession();
  const res = await fetch(`${cfg.newapi_url}${path}`, {
    ...options,
    headers: {
      Cookie: cookie,
      "New-Api-User": "1",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res.json();
}

function paginate<T>(items: T[], page: number, size: number, sort?: string, order?: string): { items: T[]; total: number; page: number; size: number; pages: number } {
  if (sort && items.length > 0) {
    const dir = order === "asc" ? 1 : -1;
    items.sort((a: any, b: any) => {
      const va = a[sort], vb = b[sort];
      if (va == null && vb == null) return 0;
      if (va == null) return dir;
      if (vb == null) return -dir;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }
  const total = items.length;
  const pages = Math.ceil(total / size);
  const start = (page - 1) * size;
  return { items: items.slice(start, start + size), total, page, size, pages };
}

const pageParams = {
  page: z.number().optional().describe("页码（默认 1）"),
  size: z.number().optional().describe("每页条数（默认 20）"),
  sort: z.string().optional().describe("排序字段"),
  order: z.enum(["asc", "desc"]).optional().describe("排序方向（默认 desc）"),
};

class JieziAdmin extends Clip {
  name = "jiezi-admin";
  domain = `解字计划（Jiezi Grant）管理后台。
解字计划资助大学生使用 AI 编程工具，每人发放 API Token（$20/$100/$400），支持 20+ 模型。

## 申请状态机

学生申请经过以下状态流转，每个状态对应系统自动执行的动作：

- **draft** — 学生在 jiezi.ai/apply 填表获得申请码（JZ-XXXX），等待提交 GitHub Issue
- **approved** — GitHub Issue 触发 webhook，Gemini LLM 审核通过，生成邮箱验证 token
- **rejected** — Gemini 审核未通过（Issue 评论原因），学生可修改信息后重新提交 Issue
- **emailed** — 验证邮件已发送到学生 edu 邮箱，等待学生点击验证链接
- **verified** — 学生点击验证链接，系统开始自动创建 New API 账号和 Key
- **fulfilled** — API 账号 + Key 创建完成，配置邮件（含 API 地址、Key、群二维码）已发送到 edu 邮箱，Issue 自动关闭

## 基础设施

- **api.jiezi.ai** — Cloudflare Workers，处理申请、webhook、验证、数据查询
- **New API** — 广州 VPS，LLM 网关，管理学生 API 账号和额度，通过新加坡代理访问 OpenRouter
- **D1** — 申请数据存储
- **Resend** — 邮件发送（grant@jiezi.ai）
- **GitHub** — jiezi-ai/grant 仓库，Issue 申请 + webhook 自动化`;

  patterns = [
    "overview → 查看批次、预算、漏斗",
    "applications(status?) → application(code) 查看申请详情和 motivation",
    "students → quota(username) 查看额度和使用情况",
    "topup(username, amount) 给学生充值",
    "toggle(username, disable|enable) 停用/启用账号",
    "retry(issue) 重试 webhook 失败的 Issue",
    "config set(key, value) → config get 管理连接配置",
  ];

  entities = {
    application: z.object({
      apply_code: z.string().describe("申请码，格式 JZ-XXXX"),
      name: z.string().describe("学生姓名"),
      school: z.string().describe("学校"),
      major: z.string().describe("专业"),
      edu_email: z.string().describe("edu 邮箱"),
      motivation: z.string().describe("想用 AI 做什么"),
      github_id: z.string().nullable().describe("GitHub 用户名，提交 Issue 后自动关联"),
      status: z.enum(["draft", "approved", "rejected", "emailed", "verified", "fulfilled"]).describe("申请状态"),
      batch: z.number().describe("批次号"),
    }).describe("学生申请记录，存储在 Cloudflare D1"),
    student: z.object({
      username: z.string().describe("New API 用户名（= GitHub ID）"),
      email: z.string().describe("edu 邮箱"),
      quota: z.number().describe("总额度（内部单位，÷500000 = 美元）"),
      used_quota: z.number().describe("已用额度"),
      remaining_usd: z.string().describe("剩余额度（美元）"),
      request_count: z.number().describe("API 请求次数"),
      status: z.string().describe("账号状态：active / disabled"),
    }).describe("New API 学生账号，管理 API 访问和额度"),
  };

  @command("查看当前配置")
  ["config get"] = handler(
    z.object({}),
    z.any(),
    async () => {
      const stored = loadConfig();
      const result: Record<string, string> = {};
      for (const [key, label] of Object.entries(CONFIG_KEYS)) {
        const val = stored[key as keyof Config] || DEFAULTS[key as keyof Config] || "";
        result[key] = key.includes("pass") || key.includes("token")
          ? (val ? val.slice(0, 4) + "****" + val.slice(-4) : "(未配置)")
          : (val || "(未配置)");
      }
      return result;
    },
  );

  @command("设置配置项")
  ["config set"] = handler(
    z.object({
      key: z.enum(["jiezi_api_url", "jiezi_admin_token", "newapi_url", "newapi_admin_user", "newapi_admin_pass"]).describe("配置项"),
      value: z.string().describe("配置值"),
    }),
    z.any(),
    async (input) => {
      const cfg = loadConfig();
      (cfg as any)[input.key] = input.value;
      saveConfig(cfg);
      const label = CONFIG_KEYS[input.key as keyof Config];
      return { ok: true, key: input.key, label, message: `${label} 已更新` };
    },
  );

  @command("项目总览（批次、预算、漏斗）")
  overview = handler(
    z.object({}),
    z.any(),
    async () => {
      const api = getConfig().jiezi_api_url;
      const [overview, budget, sponsors]: any = await Promise.all([
        fetch(`${api}/api/overview`).then((r) => r.json()),
        fetch(`${api}/api/budget`).then((r) => r.json()),
        fetch(`${api}/api/sponsors`).then((r) => r.json()),
      ]);
      return {
        budget: {
          committed: budget.committed,
          spent: Math.round(budget.spent),
          remaining: Math.round(budget.remaining),
          currency: "CNY",
        },
        batches: overview.batches,
        funnel: overview.funnel,
        sponsors_count: sponsors.sponsors?.length || 0,
      };
    },
  );

  @command("查看申请列表（支持分页、过滤、排序）")
  applications = handler(
    z.object({
      status: z.string().optional().describe("过滤状态：draft/approved/emailed/verified/fulfilled"),
      ...pageParams,
    }),
    z.any(),
    async (input) => {
      const params = input.status ? `?status=${input.status}` : "";
      const data: any = await jieziApi(`/api/admin/applications${params}`);
      const apps = (data.applications || []).map((a: any) => ({
        apply_code: a.apply_code,
        name: a.name,
        school: a.school,
        major: a.major,
        status: a.status,
        github_id: a.github_id || null,
        edu_email: a.edu_email,
        created_at: a.created_at,
      }));
      return {
        stats: data.stats,
        ...paginate(apps, input.page || 1, input.size || 20, input.sort || "created_at", input.order || "desc"),
      };
    },
  );

  @command("查看单个申请详情（含 motivation）")
  application = handler(
    z.object({
      code: z.string().describe("申请码，如 JZ-XXXX"),
    }),
    z.any(),
    async (input) => {
      const data: any = await jieziApi("/api/admin/applications");
      const app = data.applications?.find(
        (a: any) => a.apply_code === input.code.toUpperCase(),
      );
      if (!app) return { error: `申请码 ${input.code} 不存在` };
      return {
        apply_code: app.apply_code,
        name: app.name,
        school: app.school,
        major: app.major,
        grade: app.grade,
        edu_email: app.edu_email,
        motivation: app.motivation,
        github_id: app.github_id,
        status: app.status,
        batch: app.batch,
        created_at: app.created_at,
        verified_at: app.verified_at,
      };
    },
  );

  @command("查看学生账号列表（支持分页、排序）")
  students = handler(
    z.object(pageParams),
    z.any(),
    async (input) => {
      const data: any = await newApi("/api/user/?p=0&size=200");
      const users = (data.data?.items || [])
        .filter((u: any) => u.role !== 100)
        .map((u: any) => ({
          id: u.id,
          username: u.username,
          email: u.email || "",
          display_name: u.display_name || "",
          quota: u.quota,
          used_quota: u.used_quota,
          remaining: u.quota - u.used_quota,
          remaining_usd: `$${((u.quota - u.used_quota) / 500000).toFixed(2)}`,
          request_count: u.request_count || 0,
          status: u.status === 1 ? "active" : "disabled",
        }));
      return paginate(users, input.page || 1, input.size || 20, input.sort || "id", input.order || "asc");
    },
  );

  @command("查看单个学生额度和使用详情")
  quota = handler(
    z.object({
      username: z.string().describe("学生的 GitHub ID / New API 用户名"),
    }),
    z.any(),
    async (input) => {
      const data: any = await newApi("/api/user/?p=0&size=200");
      const user = data.data?.items?.find((u: any) => u.username === input.username);
      if (!user) return { error: `用户 ${input.username} 不存在` };
      return {
        username: user.username,
        email: user.email || "",
        display_name: user.display_name || "",
        quota: user.quota,
        quota_usd: `$${(user.quota / 500000).toFixed(2)}`,
        used_quota: user.used_quota,
        used_usd: `$${(user.used_quota / 500000).toFixed(2)}`,
        remaining: user.quota - user.used_quota,
        remaining_usd: `$${((user.quota - user.used_quota) / 500000).toFixed(2)}`,
        request_count: user.request_count || 0,
        status: user.status === 1 ? "active" : "disabled",
      };
    },
  );

  @command("给学生充值额度")
  topup = handler(
    z.object({
      username: z.string().describe("学生用户名"),
      amount: z.number().describe("充值金额（美元）"),
    }),
    z.any(),
    async (input) => {
      const usersData: any = await newApi("/api/user/?p=0&size=200");
      const user = usersData.data?.items?.find((u: any) => u.username === input.username);
      if (!user) return { error: `用户 ${input.username} 不存在` };

      const quotaToAdd = input.amount * 500000;
      const newQuota = user.quota + quotaToAdd;
      const result: any = await newApi("/api/user/", {
        method: "PUT",
        body: JSON.stringify({ id: user.id, username: user.username, quota: newQuota }),
      });
      if (!result.success) return { error: result.message };

      return {
        username: input.username,
        added: `$${input.amount}`,
        previous_quota_usd: `$${(user.quota / 500000).toFixed(2)}`,
        new_quota_usd: `$${(newQuota / 500000).toFixed(2)}`,
      };
    },
  );

  @command("停用或启用学生账号")
  toggle = handler(
    z.object({
      username: z.string().describe("学生用户名"),
      action: z.enum(["disable", "enable"]).describe("操作：disable 停用 / enable 启用"),
    }),
    z.any(),
    async (input) => {
      const usersData: any = await newApi("/api/user/?p=0&size=200");
      const user = usersData.data?.items?.find((u: any) => u.username === input.username);
      if (!user) return { error: `用户 ${input.username} 不存在` };

      const status = input.action === "disable" ? 2 : 1;
      const result: any = await newApi("/api/user/", {
        method: "PUT",
        body: JSON.stringify({ id: user.id, username: user.username, status }),
      });
      if (!result.success) return { error: result.message };

      return {
        username: input.username,
        action: input.action,
        status: input.action === "disable" ? "disabled" : "active",
      };
    },
  );

  @command("重新处理失败的 GitHub Issue")
  retry = handler(
    z.object({
      issue: z.number().describe("Issue 编号"),
    }),
    z.any(),
    async (input) => {
      return jieziApi(`/api/admin/retry-issue/${input.issue}`);
    },
  );
}

if (import.meta.main) {
  await new JieziAdmin().start();
}
