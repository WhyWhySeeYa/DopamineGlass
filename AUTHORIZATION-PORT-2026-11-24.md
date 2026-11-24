# 官方 3.0.13 授权增量适配（2026-11-24）

来源为 `G:\RootHide\ZQBB IOS16\Dopamine-roothide-rc9-ios16-next` 当前工作树，包括今天尚未提交的授权修正。目标为本目录，保留开始时已有的美化和授权备份修改。

本次补齐 `DORHSupporterProofModel`：依次读取 MobileGestalt 的 MarketingProductName、ProductType，拒绝 iOS/iPadOS 等非机型名称，再尝试 sysctl 的 hw.machine。型号和系统版本进入 RHP1 v2 的签名原文；信息不可用时继续生成兼容的 v1。没有新增网络接口，仍由用户复制设备证明交给管理员核验。

本地签发辅助代码仅同步同设备换密钥返回的 deviceCode、deviceModel、osVersion 字段，使复核和补发信息与当前共用工具一致。`M:\签发工具` 的程序、资料编辑、型号名称转换、界面和真实授权数据均不写入。

旧 RH1、RHB1 协议、签发公钥、设备码算法、Secure Enclave 密钥 tag、应用身份 cn.zqbb.dopaRH、Keychain 分组、持久化路径及删除标记维持目标实现。保留目标 ECID 的 MobileGestalt/IOKit 后备读取和普通签名安装的既有越狱作用域适配。BaseBin、越狱入口、项目配置、资源、美化和专属打包配置未因本次授权适配发生修改。

新增原生回归：实际运行生产 RHP1 生成器，用一次性软件 P-256 密钥替代设备 Secure Enclave 存储，覆盖有效型号、OS 名误报、sysctl 后备、异常长度/终止符、系统版本及 v1 后备，并由 Node 签发校验器验证签名和防篡改。原有原生绑定测试继续验证 RH1/RHB1 签名、硬件及设备密钥持有证明。

共用工具验证在临时目录使用合成用户和一次性密钥执行：旧用户补齐绑定并保留原 RH1、RHP1 v2 元数据验签、历史界面加载和布局、同设备换密钥复核及补发按钮状态均通过。测试仅读取共用工具程序文件，不读取真实用户记录或签发私钥。

检查入口：`node scripts/run-rc9-tests.cjs`、`node scripts/verify-rc9-port.cjs`、`python tests/glass-app-archive.test.py`。共享工具测试另设 DORH_SHARED_ISSUER_DIRECTORY、DORH_ISSUER_SOURCE 后执行 `node --test tests/supporter-shared-issuer.test.cjs`。

本次构建复用目标 DopamineGlass 仓库既有完整构建工作流，云端沿用上次已成功的 macos-15-intel UIKit runner；本地工作流文件保持原值。完整构建将重建目标自己的底层模块，不引入 RC9 底层文件。构建结果和校验记录存放在上级 authorization-port-20261124 与 builds/11-24-authorization；Secure Enclave 真机密钥、安装和实际越狱仍需设备验收。
