# 简单盒子

`simple-box` 是一个面向 SillyTavern 的扩展集合，目前包含两个功能模块：

- **隐藏楼层**：按楼层范围隐藏 / 恢复聊天消息，仅影响前端显示，不影响 AI 上下文。
- **总结**：对指定楼层范围发起总结，支持提示词保存、静默注入、不同触发身份，以及将总结结果写入世界书。

## 当前功能

### 隐藏楼层

| 按钮 | 命令 | 说明 |
|------|------|------|
| 隐藏楼层 | `/hide <start>-<end>` | 隐藏指定范围内的楼层（仅视图层隐藏，AI 上下文不变） |
| 显示楼层 | `/unhide <start>-<end>` | 取消隐藏指定范围内的楼层 |
| 显示全部 | `/unhide 0-{{lastMessageId}}` | 取消隐藏所有楼层 |

### 总结

- **楼层范围总结**
  - 留空默认总结全部楼层。
  - 楼层范围仅作为指令提示注入，不直接裁剪 AI 上下文。

- **总结提示词管理**
  - 支持保存、加载、删除多套总结配置。
  - 内置 2 个 总结模板。

- **静默注入与启动方式**
  - 总结提示词通过 ST 上下文 API 静默注入，生成结束后自动清除。
  - 启动方式支持 `AI助手` / `User` / `System`。

- **世界书保存**
  - 支持将最新一条 AI 回复写入角色绑定世界书，或手动指定世界书名称。
  - 支持 **自动保存** 与 **手动保存回复** 两种方式。
  - 支持 **覆盖** / **追加** 两种写入模式。
  - 可选自动移除 `<thinking>...</thinking>` 内容后再写入世界书。

---

## 目录结构

```
simple-box/
├── manifest.json          # 插件清单（SillyTavern 读取）
├── index.ts               # 主入口 TypeScript 源码
├── index.js               # 编译输出（SillyTavern 加载此文件）
├── style.css              # 主样式
├── README.md              # 项目说明
├── tsconfig.json          # TypeScript 编译配置
├── package.json           # 构建脚本
├── types/
│   └── globals.d.ts       # SillyTavern 全局变量类型声明
├── 隐藏楼层/              # 功能子模块：隐藏楼层
│   ├── index.ts           # 功能逻辑 TypeScript 源码
│   ├── index.js           # 编译输出
│   └── index.html         # 功能 UI 模板
└── 总结/                  # 功能子模块：总结
    ├── index.ts           # 功能逻辑 TypeScript 源码
    ├── index.js           # 编译输出
    └── index.html         # 功能 UI 模板
```
