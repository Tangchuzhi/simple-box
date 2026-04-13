# 楼层精简 (Floor-Simplification)

SillyTavern 扩展插件，专注于聊天楼层的精准显示与隐藏管理。

## 功能

| 按钮 | 命令 | 说明 |
|------|------|------|
| 隐藏楼层 | `/hide <start>-<end>` | 隐藏指定范围内的楼层（视图层隐藏，AI 上下文不变） |
| 显示楼层 | `/unhide <start>-<end>` | 取消隐藏指定范围内的楼层 |
| 显示全部 | `/unhide 0-{{lastMessageId}}` | 取消隐藏所有楼层 |

> 楼层 **0** 代表开场白，楼层 **1** 起为正文消息。

---

## 目录结构

```
Floor-Simplification/
├── manifest.json          # 插件清单（SillyTavern 读取）
├── index.ts               # 主入口 TypeScript 源码
├── index.js               # 编译输出（SillyTavern 加载此文件）
├── style.css              # 主样式
├── tsconfig.json          # TypeScript 编译配置
├── package.json           # 构建脚本
├── types/
│   └── globals.d.ts       # SillyTavern 全局变量类型声明
└── 楼层精简/              # 功能子模块（可独立拔插）
    ├── index.ts           # 功能逻辑 TypeScript 源码
    ├── index.js           # 编译输出
    └── index.html         # 功能 UI 模板
```

---

## 安装

将整个 `Floor-Simplification` 文件夹放入 SillyTavern 的以下目录：

```
SillyTavern/data/<用户名>/extensions/
```

或（旧版路径）：

```
SillyTavern/public/scripts/extensions/third-party/
```

重启 SillyTavern 后，在 **扩展设置** 面板中找到 **楼层精简** 即可使用。

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

## 扩展新功能

每个功能模块放在独立子文件夹，结构如下：

```
<功能名称>/
├── index.ts    # 逻辑（TypeScript）
├── index.js    # 编译输出
└── index.html  # UI 模板
```

在 `index.ts` 主入口的 `setTimeout` 区块中调用 `loadFeatureModule('<功能名称>', '<容器id>')` 即可接入。
