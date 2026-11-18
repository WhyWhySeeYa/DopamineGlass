# ZQBB 3.0.13：RC9 玻璃主题与授权移植

## 2026-11-18 返回与设备证明修复

默认主题继续使用官方的紧凑卡片与“点击卡片外返回”交互，不增加玻璃返回按钮。移植曾把 `DOModalBackAction` 插到 UIKit 全屏容器下方；现将它置于容器上方，并在页面切换时恢复其层级，卡片内触摸仍由原 `ignoreFrame` 放行。玻璃页保留既有独立返回按钮。

RHC1 解析通过后出现 `hardware-identity / -1`，表示生成 RHP1 时无法取得硬件身份。当前签名缺少 MobileGestalt 的受保护键声明；新增 `com.apple.private.MobileGestalt.AllowedProtectedKeys = [UniqueChipID]`，并要求最终可执行文件的签名也包含这一精确权限。硬件哈希算法、协议、设备码、密钥和合法旧授权不变。这是针对缺失权限的修复，是否消除设备报错仍须重新安装后的真机验收。

本地 Node 回归：112 项，106 通过、6 因 Windows 环境跳过、0 失败；上游边界检查通过。UIKit 回归增加真实触摸命中检查：卡片外触发返回、卡片内保留按钮触摸、隐藏时不拦截。独立 App 工作流增加该程序的原生编译检查；编译通过不代表模拟器运行或真机授权通过。

记录日期：2026-11-17（America/Denver）。状态：源码移植候选，尚未原生构建或真机验收。

## 基线与范围

- 工作分支：`rc9-glass-authorization`。
- ZQBB 源码基线：`3ac500e9d95553c2ffd651894315d79b31ee8aed`，公开分支 `3.x_roothide_AI_review_fix`。
- RootHide 30 祖先提交：`9617d75f476423fdfd33477299c8a1349eb6f375`。
- RC9 来源提交：`f6295a208781974b09227eeab9723dc180329f71`。
- 此公开源码包含 3.0.13/30 更新，但尚未证明它就是原发布 IPA 的精确构建提交。
- 保留 ZQBB 原底层、漏洞利用、支持范围、包管理器、设置业务方法、普通主题及备用图标。
- 不移植 RC9 的 iOS16-only 裁剪、低电量计划、自定义挂载或越狱底层修改。

精确来源和不可变导入文件的 SHA-256 记录在本目录的 `rc9-port-manifest.json`；移植回归对照记录在 `../tests/RC9-TEST-ADAPTATIONS.json`。

## 已接入

1. RC9 玻璃材质、首页、设置/关于页及返回/滚动布局。
2. 头像、昵称、签名、焦点模式、静态壁纸、视频/Live Photo 导入和媒体生命周期。
3. 玻璃参数、预览、重置、跨越狱状态的主题持久化。
4. 原 RH1 授权、公钥核验、RHB1 设备绑定、证明和诊断界面。
5. 必要的 Xcode 文件/框架引用、精确 Keychain 权限和中英文本。
6. 独立上游边界保护、授权和玻璃回归，macOS/模拟器验证入口及包内权限检查。

新主题键为 `custom_glass`，作为新增主题列在原有主题列表中。全新安装一律默认使用 Dopamine 的 `default` 主题（原版首页），授权不会自动切换界面；只有已授权且在原设置的主题列表中明确选择玻璃项后，才进入 RC9 界面。未授权时主题列表不显示玻璃项。若已有偏好仍指向 `custom_glass`，撤销/缺少授权时会切换并保存为 `default`。原 ZQBB 主题/图标仍可从原设置入口选择。

这是 ZQBB 的独立 App 包。授权只控制 RC9 玻璃主题及其专属的外观、个人资料和壁纸自定义；未授权或选择普通主题时，首页使用从固定 ZQBB 基线提取的原版布局、信息列、菜单和越狱按钮；设置与关于页保留原版窗口/表格路径，不创建 RC9 卡片、头像或全屏返回控件。玻璃渲染器的不透明降级仅是撤销授权时页面重建前的防护，不是默认界面。**授权不控制 ZQBB 的原越狱入口、普通主题选择或重启/重载动作**。越狱执行方法和按钮标题与基线逐方法比对，另一越狱已激活时的原保护仍保留。

## 数据与授权兼容

- Bundle ID 仍为 `cn.zqbb.dopaRH`，版本来源仍为上游 3.0.13-30；没有手动改版号冒充升级。
- RH1/RHB1 协议、公钥、旧设备码和授权偏好键未改。签发私钥不进入 App，未读取真实签发目录。
- 授权持久化保留 `/var/mobile/Library/Application Support/DopamineRH/supporter-state.plist`。
- 主题同步保留 RC9 实现的 `/var/mobile/Library/Application Support/DopamineRH-iOS16/glass-theme.plist`。目录名只是历史存储命名，不代表移植后的 App 被限制为 iOS16。
- 媒体仍归应用实际数据容器所有。不搬动、删除或导入 RC9 原容器中的文件。更换容器后的头像/壁纸是否需要重新选择，以真机验证为准；没有承诺跨卸载自动迁移。
- 原 ZQBB 文案保持不变，新 UI 主要提供英文、简体中文，其余语言沿用 App 的英文后备机制。

原版首页方法位于 `Application/Dopamine/UI/DOStockHome.inc`，由现有首页编译单元包含；`DOThemePresentation.h` 统一决定普通/玻璃路径。界面切换在首页显示时安全重建，不中断已展开的越狱流程或授权弹窗；授权弹窗的“立即应用”仍可触发完整重建。原版方法按明确的选择器改名和共享生命周期适配与上游逐方法比较；提取时仅额外清理上游遗留的行尾空白，以满足严格补丁校验。

重启/重载卡片使用 ZQBB 原有的 `void` 动作接口；不会为迁就 RC9 的返回码改动环境管理器。如果请求返回且进程仍存活，恢复页面交互，不虚构成功/失败状态。

## 本地检查

在工程根目录执行：

```powershell
node scripts/run-rc9-tests.cjs
node scripts/verify-rc9-port.cjs
```

`verify-rc9-port.cjs` 需要基线 Git 对象可用；它会检查保护目录、原设置方法与 specifier、越狱方法、恢复的原版首页方法、所有原 Xcode 对象以及来源文件哈希。不要通过放宽保护规则来消除失败。

补丁导出/顺序应用核验（临时索引和对象目录，真实 Git 索引不变）：

```powershell
node scripts/export-rc9-patches.cjs
```

模拟器验证入口另加入 13 组主题选择/授权组合与撤销后恢复材质检查；Foundation 入口执行生产主题解析方法，覆盖无偏好、无效偏好、普通主题、玻璃主题与撤销后重新授权。本机未执行这些原生入口；云端 Foundation 入口现已通过，UIKit 入口已通过原生编译但尚未完成模拟器运行。

macOS 可另外运行模拟器测试（不是 Windows 上的源码检查）：

```sh
DORH_RUN_UIKIT_SIMULATOR=1 DORH_SIMULATOR_RUNTIME=18.5 \
  node --test --test-name-pattern='UIKit simulator exercises' tests/glass-ui-contracts.test.cjs
```

工作流 `../.github/workflows/main.yml` 已修正为检出当前仓库，而不是硬编码下载另一份官方仓库。`port-tests` 可独立运行 macOS 回归，不需要下载底层子模块；手动执行工作流时还要求 `uikit-layout` 通过，再进入完整构建。用户确认后已推送至 `kulinichx/DopamineGlass` 的 `rc9-glass-authorization` 分支，并启动 Actions；没有发布 Release。初次 macOS 回归 108 项中 107 通过、0 失败、1 项 UIKit 按入口跳过。单独 UIKit 作业在调整冷启动等待后，已通过 Xcode 16.4 / iOS Simulator 18.5 原生编译；增加有界首次启动等待后，运行 `44080329731` 已完成模拟器启动，但 `simctl install` 在 120 秒超时，仍未进入界面断言。诊断已保存，不继续无依据地延长超时或跳过检查；不能把编译通过当作布局测试通过。详见 `RC9-VALIDATION.json`。

## 当前构建限制

本机为 Windows，没有 Xcode/iOS SDK。云端已运行 macOS/Foundation 回归；独立 App + 官方预编译底层路线现已成功编译、签名和生成 IPA/TIPA（运行 44094121720，源码提交 a96f416）。全源码底层重建仍受下述依赖问题阻断；UIKit 程序编译通过但安装超时，运行验证未完成，Secure Enclave 真机验证未执行。

补齐依赖时，`BaseBin/ChOma` 锁定提交 `4e4f8849e7a2025ab1717fe0a214d6363b9c1cc6` 无法从上游配置的 `opa334/ChOma` 仓库取得，Git 报 `not our ref`。已把未完成检出恢复为未初始化状态，**没有使用 main 或更改 gitlink**；其余顶层可用子模块按原锁定提交检出，XPF 嵌套依赖尚未全部初始化。

首次推送的云端完整构建已在递归检出时被此问题阻断（`not our ref`）。应从可信已有缓存恢复该精确对象，或由上游明确修复/确认依赖；不能为了打包而偷偷换依赖。这个阻碍不影响已完成的源码检查，但源码检查通过不能证明可安装包可用。

## 以后跟随上游升级

1. 先核对新 ZQBB RootHide 发布物、公开源码分支和提交对应关系；普通版标签不等于 RootHide 源码。
2. 在保留当前移植候选的前提下，基于新上游建升级分支，重放玻璃组件、授权、页面接入、验证/文档四组改动。
3. 对混合文件逐项解决冲突，不整文件覆盖新的首页、设置、项目或启动逻辑。
4. 确认新上游身份后，更新清单中的上游基线与对应验收记录；原保护检查应继续成立。上游新增业务按新基线保留。
5. 运行回归、macOS 原生构建、包内权限/资源检查、模拟器布局和真机授权/越狱验收。
6. 真机至少覆盖：未授权仍可使用原越狱；合法旧/新授权、错误设备/无效码、撤销失败；头像/静态和动态壁纸；前后台、重新加载、重启；原 ZQBB 主题、备用图标、设置、包管理器和原支持范围。

源码已按用户请求提交并推送至其 GitHub 仓库以执行构建。测试安装包已在 Actions Artifact 中生成，没有发布 Release 或设置自动升级；后续构建记录须继续区分源码回归、原生 UIKit 验证和 App 打包结果。

## 独立 App / 官方预编译底层构建路线

新增手动工作流 `.github/workflows/glass-app-build.yml`，不替代原来的全源码工作流。固定取 ZQBB 官方 `Dopamine_roothide_zqbb_3.0.13-30_20261106_103030.ipa`，SHA-256 为 `cb90db40fdc085ba1f8e6c56a6bb3220d902497fa66a860b66b2a24fced52394`（已核对官方 Release asset digest 和本地文件）。

- 当前 App 源码重新编译，临时项目禁用底层 target；原项目、BaseBin 和 gitlink 不改。
- 最终包以该官方 IPA 为底稿，保留所有 Frameworks、dylib、deb、bootstrap、basebin 和 PkgManagers.plist；打包后核对全部 48 个底层文件及 SHA-256。
- XPF 头文件使用原 gitlink 的精确提交。ChOma 缺失提交不能恢复，因此仅用公开 `7dccded` 的头文件声明编译，不编译或替换 ChOma 库；每个头文件单独固定 SHA-256。声明与官方二进制的 ABI 兼容性仍需真机验证。
- App 的 zstd 显式锁定 v1.5.7 提交 `f8745da6ff1ad1e7bab384bd1f9d742439278e99`，不追随原 dev 分支漂移；仅改变临时项目的包解析。
- 产物仅为 TEST CANDIDATE，不是全源码可复现发行版，也没有绕过后声称 UIKit 验收通过。既有 UIKit 作业仍保留。不会自动发布 Release。
- 跟随新版官方升级时，需重新审查源码基线、官方 IPA 地址/校验值和头文件，不能只改版本号。

本地验证：111 项 Node 测试中 105 通过、6 按环境跳过、0 失败；另有 8 项 Python 归档安全/核心边界及打包防覆盖测试全部通过。独立云端 App 构建记录见 RC9-VALIDATION.json。

Xcode 16.4 构建兼容：设置/关于页显式引用上层目录的主题策略头文件；临时项目对 DOBootstrapper.m 增加 `-fno-builtin-strrchr`，保留上游原 libc 调用，避免优化后引入 SDK 中无法链接的 `_memrchr`。不改动该文件或版本比较逻辑。

成功构建：`https://github.com/kulinichx/DopamineGlass/actions/runs/44094121720`，产物 `DopamineGlass-official-core-TEST-5`。包含 `.ipa`、同内容的 `.tipa`、`BUILD-REPORT.json` 和测试包说明。编译、签名身份检查及所有 48 个底层文件的最终归档 SHA-256 校验全部通过。

按用户后续要求，独立 App 打包流程现移除内置 `zebra.deb`，并从最终 `PkgManagers.plist` 中仅移除 `xyz.willy.Zebra` 对应条目，保留 Sileo 原条目和安装包。所有 46 个其余保护文件继续逐字节校验；原始 Zebra 包和配置也先按输入哈希核验，并在报告中单列删改结果。不会卸载设备上已有的 Zebra。原源码、底层模块与依赖锁定未改；未来全源码路线如恢复，需同步采用这项已授权的资源裁剪。产物仍按用户要求保留 IPA/TIPA 两种后缀。

去斑马版本已构建成功：运行 `44097054652`，源码 `7d37fcd`，产物 `DopamineGlass-official-core-TEST-6`。单个 IPA/TIPA 为 31,327,830 字节（29.88 MiB），SHA-256 `6d441074c968bd3cdf4ee8f79126487b004a4e733e1e168c4d60e58977bd3b16`。已下载后独立核对 ZIP/安装包哈希、Zebra 不存在、Sileo 字节完整以及全部 46 个保留文件。设备上已安装 Zebra 不会因此卸载；真机授权和越狱操作尚待验收。
