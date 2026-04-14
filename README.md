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

> 楼层 **0** 代表开场白，楼层 **1** 起为正文消息。

### 总结

- **楼层范围总结**
  - 留空默认总结全部楼层。
  - 楼层范围仅作为指令提示注入，不直接裁剪 AI 上下文。

- **总结提示词管理**
  - 支持保存、加载、删除多套总结配置。
  - 内置 2 个 Janus 灵魂典藏馆相关总结模板。

- **静默注入与启动方式**
  - 总结提示词通过 ST 上下文 API 静默注入，生成结束后自动清除。
  - 启动方式支持 `AI助手` / `User` / `System`。
  - `User` 模式下触发文本会作为可见消息发送；`AI助手` / `System` 模式为静默触发。

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

---

## 安装

将整个 `simple-box` 文件夹放入 SillyTavern 的以下目录：

```
SillyTavern/data/<用户名>/extensions/
```

或（旧版路径）：

```
SillyTavern/public/scripts/extensions/third-party/
```

重启 SillyTavern 后，在 **扩展设置** 面板中找到 **简单盒子** 即可使用。

## 使用说明

### 隐藏楼层

在插件面板中输入起止楼层后执行隐藏或恢复即可。

- **留空起始 / 结束值**：按命令或界面逻辑处理为完整范围
- **隐藏效果**：只影响当前聊天视图，不改变模型真正能看到的历史上下文

### 总结

1. 填写或加载一套 **总结提示词**。
2. 选择需要总结的楼层范围；留空默认总结全部楼层。
3. 选择启动方式，并填写触发文本。
4. 点击 **开始总结**。

如果启用了 **自动保存**：

- 在点击 **开始总结** 后，待总结内容生成完成，会自动写入世界书条目。

如果使用 **手动保存回复**：

- 会将当前对话中最新一条 AI 回复写入世界书。
- 适用于补存总结、保存通过其他方式生成的总结，或归档任意非总结文本。

新建世界书条目默认使用：

- **角色定义之前**
- **蓝灯常驻**

---

## 开发 & 构建

```bash
# 安装依赖
npm install

# 编译 TypeScript → JavaScript（一次性）
npm run build

# 监听模式（修改 .ts 文件后自动重新编译）
npm run watch

# 删除编译产物
npm run clean
```

> **注意**：修改 `.ts` 源文件后必须重新 `build`，SillyTavern 加载的是编译后的 `.js` 文件。

---

## 开发说明

### 模块接入方式

每个功能模块放在独立子文件夹，结构如下：

```
<功能名称>/
├── index.ts    # 逻辑（TypeScript）
├── index.js    # 编译输出
└── index.html  # UI 模板
```

在 `index.ts` 主入口的 `setTimeout` 区块中调用 `loadFeatureModule('<功能名称>', '<容器id>')` 即可接入。

### 代码改动注意事项

- 修改 `*.ts` 后必须重新执行 `npm run build`
- SillyTavern 实际加载的是编译后的 `*.js`
- 如果新增模块，记得同步更新 `tsconfig.json` 的 `include`
- 如果新增编译产物，记得同步更新 `package.json` 中的 `clean` 脚本
