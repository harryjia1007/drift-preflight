# 第一次使用 Drift Preflight：Mac 操作流程

适用于 **Drift Preflight 0.1.0-alpha.3、Apple Silicon Mac（arm64）、Node.js 24**。实际验证环境为 Node.js 24.16.0；其他操作系统和 Node 主版本尚未验证。可在苹果菜单 →“关于本机”查看芯片；Apple M 系列属于这里的 Apple Silicon。

这次运行两个虚构案例：一个应当通过，一个故意遗漏必要客户，应该被工具发现。结果会显示在“终端机”的文字窗口中。程序没有图形界面，也不会在运行案例时访问真实客户服务。

每次只复制当前步骤中标为“执行”的命令，粘贴后按 Return（回车）。“预计看到”的内容是结果，不要复制执行。看到终端机重新出现 `%` 或 `$` 输入提示，表示上一条命令结束；不要把提示符一起输入。全程使用同一个窗口，任何步骤与预期不符时，先查看文末的出错处理。

如果愿意记录试用时间，先记下开始时间，最后分别记录人工操作与下载等待；没有计时也可以如实填写。

## 1. 打开终端机

同时按 **⌘ Command＋空格**，搜索 `Terminal`，按回车打开“终端机”。也可以从 Finder →“应用程序”→“实用工具”中打开“终端机”。

窗口里已有用户名、电脑名或路径是正常的。把命令粘贴到最后一行光标处即可。

## 2. 检查 Node.js

Node.js 是运行这个工具所需的环境。执行：

```sh
node --version
```

预计看到 `v24.` 开头的版本，例如：

```text
v24.16.0
```

已有 `v24.` 就继续第 3 步。如果显示 `command not found`，说明当前终端机找不到 Node.js：打开 [Node.js 官方下载页](https://nodejs.org/en/download)，选择 **24.x**、**macOS** 的安装程序 `.pkg`，下载后按照安装窗口操作。安装完成后重新打开终端机，再执行上面的版本命令。官方也提供 [24.16.0 版本的下载档案](https://nodejs.org/en/download/archive/v24.16.0)，其中列有 macOS 安装程序；它是本项目已验证的版本记录。

如果原本已有其他主版本，或安装后仍找不到 Node.js，先保留当前环境并按文末方式回报版本和卡点。后续命令需要 `node --version` 显示 `v24.`。

## 3. 新建试用文件夹

执行：

```sh
cd "$(mktemp -d "$HOME/Downloads/drift-preflight.XXXXXX")"
```

这会在“下载”文件夹中新建独立文件夹并进入它。每次都会建立不同的文件夹。若出现错误，先停下，不要继续下载。

接着执行，查看文件夹位置：

```sh
pwd
```

输出路径应以 `/Downloads/drift-preflight.` 加随机字符结束，例如 `drift-preflight.Abc123`。最后的字符不同是正常的。后续文件都会放在这里。

## 4. 下载程序和校验文件

下面的命令下载 [alpha.3 发布页](https://github.com/harryjia1007/drift-preflight/releases/tag/v0.1.0-alpha.3)中的两个文件。先执行第一行，等它完成：

```sh
curl -fL --proto '=https' -o harryjia1007-drift-preflight-0.1.0-alpha.3.tgz https://github.com/harryjia1007/drift-preflight/releases/download/v0.1.0-alpha.3/harryjia1007-drift-preflight-0.1.0-alpha.3.tgz
```

再执行：

```sh
curl -fL --proto '=https' -o SHA256SUMS https://github.com/harryjia1007/drift-preflight/releases/download/v0.1.0-alpha.3/SHA256SUMS
```

下载过程中显示进度和数字是正常的。如果出现 `curl: (...)` 错误，先停止，记录错误文字。下载需要网络；运行这两个本地案例不需要网络或 API key。

## 5. 检查文件是否完整

执行：

```sh
shasum -a 256 -c SHA256SUMS
```

预计看到：

```text
harryjia1007-drift-preflight-0.1.0-alpha.3.tgz: OK
```

**只有看到这个文件名后面的 `OK` 才继续解压。** 出现 `FAILED` 或找不到文件时，停在这里。校验用于确认下载字节与发布的校验值相符；应从上述项目发布页取得文件。

## 6. 解压并确认程序版本

执行：

```sh
tar -xzf harryjia1007-drift-preflight-0.1.0-alpha.3.tgz
```

成功时可能没有任何文字输出。如果没有报错，再执行：

```sh
cd package
```

这会进入刚解压的程序文件夹。接着执行：

```sh
node src/cli.mjs --version
```

预计看到：

```text
0.1.0-alpha.3
```

看到这个版本后，继续运行案例。此路径不需要额外执行 `npm install`。

## 7. 运行正常案例

这个案例要求查询结果包含两位指定的虚构客户，旧版和新版的结果都符合要求。

把下面两行作为一整段复制执行：

```sh
node src/cli.mjs check examples/scoped-pass.json
echo $?
```

终端机会显示一段 JSON 检查报告。在靠前的位置寻找：

```json
"status": "PASS_SCOPED"
```

最后会单独显示 `0`。`PASS_SCOPED` 表示提供的可比较检查条件通过；它不是整个系统安全的保证。最后的数字是程序的结束代码。

报告较长时，可以向上滚动查看开头。报告中的 `engineVersion` / `reportVersion` 是引擎和报告格式版本，与第 6 步的 CLI 发布版本不是同一个字段。

## 8. 运行故意有问题的案例

这次新版查询结果故意少了必要客户 `customer_002`。**本案例预计出现 `FAIL`，表示工具成功发现准备好的问题。**

把下面两行作为一整段复制执行：

```sh
node src/cli.mjs check examples/semantic-regression.json
echo $?
```

报告靠前的位置应该出现：

```json
"status": "FAIL"
```

最后会单独显示 `1`。这是这个案例的预期结果。

两处 `echo $?` 都是在显示紧接着的上一条命令的结束代码。请将两行连着执行，中间不要插入其他命令。

| 案例 | 预期 status | 最后的结束代码 |
| --- | --- | --- |
| `scoped-pass.json` | `PASS_SCOPED` | `0` |
| `semantic-regression.json` | `FAIL` | `1` |

如果看到 `REVIEW`、`INCONCLUSIVE`、`UNSUPPORTED` 或代码 `2` / `3`，先记录结果并回报；对这里未修改的两个案例来说，它们不属于预期结果。

## 9. 回报结果或卡点

如果是项目维护者带你试用，可以在原对话里回复；也可以填写 [试用回馈](https://github.com/harryjia1007/drift-preflight/issues/new?template=trial-feedback.yml)。未完成也可以回报。下列文字是填写模板，不是终端机命令：

```text
我做到第几步：
第一个案例：PASS_SCOPED / 其他 / 没跑到
第二个案例：FAIL / 其他 / 没跑到
人工操作大约花多久：没计时也可以
下载或等待大约花多久：没计时也可以
哪一步最难懂或卡住：
除了这份说明，是否需要其他人或 AI 帮助：
```

GitHub issue 是公开的。只分享简短、去除私密信息的文字；不要贴完整报告、真实客户资料、凭证或私人绝对路径。疑似安全问题使用 [私人漏洞回报](https://github.com/harryjia1007/drift-preflight/security/advisories/new)。

## 遇到问题时

| 看到什么 | 先怎么处理 |
| --- | --- |
| `node: command not found` 或 `command not found: node` | 回到第 2 步检查 Node.js。 |
| `mktemp` / `cd` 报错，或提示无法访问“下载” | 停在第 3 步，回报简短错误；不要在不确定位置时继续下载。 |
| `curl: (...)` | 停止下载流程，确认网络可用并回报错误编号；还不能解压。 |
| 校验显示 `FAILED` | 不运行该下载文件，回报校验失败。 |
| `No such file` / `Cannot find module` | 执行 `pwd` 查看是否还在本次试用文件夹。第 7–8 步应位于其 `package` 子文件夹；回报时隐藏路径中的私人信息。 |
| 第二个案例显示 `FAIL`，最后是 `1` | 符合预期，继续第 9 步。 |
| 忘记自己在哪个文件夹，或关闭了终端机 | 可从第 3 步重新建立一份独立试用目录；原目录会保留。 |

完成后可以关闭终端机；案例结束后没有持续运行的后台服务。试用文件留在第 3 步建立的下载目录中。

这份流程涵盖下载、校验和示例运行。若要描述自己的检查条件，请接着阅读 [JSON 文件格式与缺失客户示例](BUNDLE-FORMAT.md)。这些虚构案例本身不能证明真实业务覆盖、省工或企业需求。
