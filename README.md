# jiezi-admin-clip

[解字计划](https://github.com/jiezi-ai/grant)的管理 Clip，基于 [Pinix](https://github.com/nicepkg/pinix) 平台运行。

通过 AI Agent 直接管理解字计划的申请、学生账号和 API 额度。

## 命令

| 命令 | 说明 |
|------|------|
| `overview` | 项目总览（批次、预算、漏斗） |
| `applications` | 申请列表（支持分页、状态过滤、排序） |
| `application` | 单个申请详情（含 motivation） |
| `students` | 学生账号列表（支持分页、排序） |
| `quota` | 单个学生额度和使用详情 |
| `topup` | 给学生充值额度 |
| `toggle` | 停用/启用学生账号 |
| `retry` | 重试失败的 GitHub Issue |
| `config set` | 设置配置项 |
| `config get` | 查看当前配置 |

## 安装

```bash
# 通过 Pinix Registry
pinix hub add @cp/jiezi-admin --alias jiezi-admin

# 首次使用需配置
pinix invoke jiezi-admin "config set" --key jiezi_admin_token --value "your-token"
pinix invoke jiezi-admin "config set" --key newapi_admin_user --value "your-user"
pinix invoke jiezi-admin "config set" --key newapi_admin_pass --value "your-pass"
```

## 使用

```bash
# 项目总览
pinix invoke jiezi-admin overview

# 查看所有申请
pinix invoke jiezi-admin applications

# 按状态过滤
pinix invoke jiezi-admin applications --status verified

# 查看学生额度
pinix invoke jiezi-admin quota --username lijin04

# 充值
pinix invoke jiezi-admin topup --username lijin04 --amount 10

# 重试失败的 Issue
pinix invoke jiezi-admin retry --issue 6
```

## 配置项

| Key | 说明 | 默认值 |
|-----|------|--------|
| `jiezi_api_url` | 解字 API 地址 | `https://api.jiezi.ai` |
| `jiezi_admin_token` | 管理后台 Token | — |
| `newapi_url` | New API 地址 | `http://43.138.244.147:3000` |
| `newapi_admin_user` | New API 管理员用户名 | — |
| `newapi_admin_pass` | New API 管理员密码 | — |

配置存储在 `~/.config/jiezi-admin/config.json`。

## 相关仓库

| 仓库 | 说明 |
|------|------|
| [jiezi-ai/grant](https://github.com/jiezi-ai/grant) | 政策、预算、账本 |
| [jiezi-ai/jiezi.ai](https://github.com/jiezi-ai/jiezi.ai) | 官网和后端服务 |

## License

MIT
