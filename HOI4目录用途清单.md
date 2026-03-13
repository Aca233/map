# Hearts of Iron IV 目录与子目录用途清单

> 基于本机路径：`C:/Program Files (x86)/Steam/steamapps/common/Hearts of Iron IV`
>
> 说明：以下为**根目录一级文件夹**及其**一级子文件夹**用途说明（按实际目录结构整理）。

## 本次补充（大概改动位置）
- `dlc/` 段落：由少量条目扩展为完整 `dlc001` ~ `dlc049` 列表。
- `dlc/` 段落后：新增“`dlc/` 内常见一级子目录（实测）”。
- `dlc/` 段落后：新增“含界面逻辑包（含 `interface/` 目录）”名单。
- `integrated_dlc/` 段落：补充各目录包含类型（`interface/gfx/music/sound`）。
- `integrated_dlc/` 段落后：新增“DLC 对当前数据抽取的影响（按目录类型）”。

## 根目录一级文件夹用途

| 文件夹 | 用途 |
|---|---|
| `EmptySteamDepot` | Steam 预留/占位目录（通常为空）。 |
| `assets` | 启动器或游戏外壳资源（按钮、背景、字体等）。 |
| `browser` | 内置网页/百科相关脚本。 |
| `cef` | Chromium Embedded Framework 运行库。 |
| `common` | 核心规则配置（国家、科技、AI、单位、脚本化规则）。 |
| `country_metadata` | 国家元数据。 |
| `crash_reporter` | 崩溃上报组件。 |
| `dlc` | DLC 内容目录。 |
| `dlc_metadata` | DLC 元数据。 |
| `documentation` | 官方文档（命令/脚本说明）。 |
| `events` | 事件脚本。 |
| `gfx` | 图形资源与渲染配置。 |
| `history` | 开局历史数据（国家/州/单位初始状态）。 |
| `integrated_dlc` | 集成到本体的 DLC 内容。 |
| `interface` | UI 界面定义。 |
| `localisation` | 多语言本地化文本。 |
| `map` | 地图核心数据（地形、省份关系、建筑、补给区等）。 |
| `music` | 音乐资源。 |
| `pdx_browser` | Paradox 内置浏览器组件。 |
| `pdx_launcher` | Paradox 启动器组件。 |
| `pdx_online_assets` | 联网/在线资源素材。 |
| `portraits` | 人物肖像定义。 |
| `previewer_assets` | 预览器工具资源。 |
| `script` | Lua 脚本。 |
| `sound` | 音效资源与音频配置。 |
| `tests` | 测试数据。 |
| `tools` | 开发与美术管线工具。 |
| `tutorial` | 教学引导脚本。 |
| `tweakergui_assets` | 调参 GUI 资源。 |
| `wiki` | 离线 wiki 页面与资源。 |

---

## 一级子文件夹清单与用途

## `cef/`
- `linux`：Linux 平台 CEF 运行库
- `win32`：Windows 平台 CEF 运行库

## `common/`
- `abilities`：能力定义
- `aces`：王牌飞行员相关
- `ai_areas`：AI 区域划分
- `ai_equipment`：AI 装备选择
- `ai_faction_theaters`：AI 阵营战区
- `ai_focuses`：AI 国策偏好
- `ai_navy`：AI 海军策略
- `ai_strategy`：AI 战略权重
- `ai_strategy_plans`：AI 预设战略计划
- `ai_templates`：AI 师模板
- `autonomous_states`：自治状态规则
- `bookmarks`：开局书签
- `bop`：权力平衡系统
- `buildings`：建筑类型定义
- `characters`：角色定义
- `collections`：集合配置
- `continuous_focus`：持续国策
- `countries`：国家定义
- `country_leader`：国家领导人
- `country_tag_aliases`：国家 TAG 别名
- `country_tags`：TAG 映射
- `decisions`：决议系统
- `defines`：全局常量参数
- `difficulty_settings`：难度设置
- `doctrines`：学说系统
- `dynamic_modifiers`：动态修正
- `equipment_groups`：装备分组
- `factions`：阵营规则
- `focus_inlay_windows`：国策内嵌窗口配置
- `frontend`：前端/主菜单规则
- `game_rules`：游戏规则开关
- `generation`：生成逻辑
- `idea_tags`：理念标签
- `ideas`：理念定义
- `ideologies`：意识形态
- `intelligence_agencies`：情报机构
- `intelligence_agency_upgrades`：情报机构升级
- `map_modes`：地图模式
- `medals`：勋章系统
- `military_industrial_organization`：军工组织（MIO）
- `modifier_definitions`：修正项定义
- `modifiers`：修正器
- `mtth`：平均触发时间参数
- `names`：命名池
- `national_focus`：国策树
- `occupation_laws`：占领法
- `on_actions`：触发钩子
- `operation_phases`：行动阶段
- `operation_tokens`：行动代币
- `operations`：特工行动
- `opinion_modifiers`：外交评价修正
- `peace_conference`：和会规则
- `profile_backgrounds`：档案背景
- `profile_pictures`：档案头像
- `raids`：突袭系统
- `resistance_activity`：抵抗活动
- `resistance_compliance_modifiers`：抵抗/顺从修正
- `resources`：资源类型定义
- `ribbons`：勋带展示
- `scientist_traits`：科学家特质
- `scorers`：评分逻辑
- `script_constants`：脚本常量
- `scripted_diplomatic_actions`：脚本化外交行动
- `scripted_effects`：脚本化效果
- `scripted_guis`：脚本化 UI
- `scripted_localisation`：脚本化本地化
- `scripted_triggers`：脚本化触发器
- `special_projects`：特殊项目系统
- `state_category`：州类别
- `strategic_locations`：战略地点定义
- `technologies`：科技树
- `technology_sharing`：科技共享
- `technology_tags`：科技标签
- `terrain`：地形参数
- `timed_activities`：限时活动
- `unit_leader`：指挥官规则
- `unit_medals`：单位勋章
- `unit_tags`：单位标签
- `units`：单位类型定义
- `wargoals`：战争目标

## `crash_reporter/`
- `binaries`：崩溃上报可执行组件

## `dlc/`
- `dlc001_german_historical_portraits`：德意志历史肖像包
- `dlc002_polish_content_pack`：波兰内容包
- `dlc003_rocket_launcher_unit_pack`：火箭炮单位包
- `dlc004_famous_battleships_unit_pack`：著名战列舰单位包
- `dlc005_heavy_cruisers_unit_pack`：重巡洋舰单位包
- `dlc006_soviet_tanks_unit_pack`：苏联坦克单位包
- `dlc007_german_tanks_unit_pack`：德国坦克单位包
- `dlc008_french_tanks_unit_pack`：法国坦克单位包
- `dlc009_british_tanks_unit_pack`：英国坦克单位包
- `dlc010_us_tanks_unit_pack`：美国坦克单位包
- `dlc011_german_march_order_music_pack`：德国军乐包
- `dlc012_allied_radio_music_pack`：盟军电台音乐包
- `dlc013_sabaton`：Sabaton 音乐包
- `dlc014_wallpaper`：壁纸包
- `dlc016_artbook`：艺术设定集
- `dlc017_original_soundtrack`：原声音乐集
- `dlc018_together_for_victory`：同仇敌忾（TFV）
- `dlc019_sabaton_vol2`：Sabaton 第二辑
- `dlc020_death_or_dishonor`：玉碎瓦全（DoD）
- `dlc021_anniversary_pack`：周年纪念包
- `dlc022_waking_the_tiger`：唤醒勇虎（WtT）
- `dlc023_man_the_guns`：炮手就位（MtG）
- `dlc024_man_the_guns_wallpaper`：MtG 壁纸包
- `dlc025_axis_armor_pack`：轴心装甲包
- `dlc026_radio_pack`：电台音乐包
- `dlc027_la_resistance_preorder_bonus`：抵抗运动预购奖励
- `dlc028_la_resistance`：抵抗运动（LaR）
- `dlc029_allied_armor_pack`：盟军装甲包
- `dlc030_allied_speeches_pack`：盟军演讲包
- `dlc031_battle_for_the_bosporus`：博斯普鲁斯之战（BftB）
- `dlc032_eastern_front_planes_pack`：东线飞机包
- `dlc033_songs_of_the_eastern_front`：东线之歌音乐包
- `dlc034_no_step_back`：绝不后退（NSB）
- `dlc035_no_step_back_preorder_bonus`：NSB 预购奖励
- `dlc036_by_blood_alone`：浴血奋战（BBA）
- `dlc037_by_blood_alone_preorder_bonus`：BBA 预购奖励
- `dlc038_arms_against_tyranny`：抗暴卫国（AAT）
- `dlc039_arms_against_tyranny_preorder_bonus`：AAT 预购奖励
- `dlc040_trial_of_allegiance`：忠诚试炼（ToA）
- `dlc041_trial_of_allegiance_preorder_bonus`：ToA 预购奖励
- `dlc042_content_creator_pack_soviet_union_2d_art`：内容创作者包（苏联 2D 美术）
- `dlc043_gotterdammerung`：诸神黄昏（Götterdämmerung）
- `dlc044_expansion_pass_1_ride_of_the_valkyries`：扩展通行证 1：女武神之骑
- `dlc045_expansion_pass_1_supporter_pack`：扩展通行证 1：支持者包
- `dlc046_graveyard_of_empires`：帝国坟场
- `dlc047_prototype_vehicles`：原型载具包
- `dlc048_expansion_pass_2_seaplane_tenders`：扩展通行证 2：水上飞机母舰
- `dlc049_no_compromise_no_surrender`：不妥协不投降

### `dlc/` 内常见一级子目录（实测）
- `gfx`：模型、贴图、图标等美术资源
- `interface`：界面定义与 UI 资源
- `music`：音乐定义与音轨
- `sound`：音效资源
- `portraits`：人物立绘/头像资源
- `Wallpaper`：壁纸内容
- `MP3`：原声音乐文件目录（如 soundtrack 包）

> 实测结论：`dlc/` 下以美术/音频/UI资源为主；规则与历史类脚本目录（如 `common`、`history`）主要出现在 `integrated_dlc/` 或压缩包内容中。

### 含界面逻辑包（含 `interface/` 目录）
- `dlc001_german_historical_portraits`
- `dlc002_polish_content_pack`
- `dlc011_german_march_order_music_pack`
- `dlc012_allied_radio_music_pack`
- `dlc013_sabaton`
- `dlc018_together_for_victory`
- `dlc019_sabaton_vol2`
- `dlc020_death_or_dishonor`
- `dlc021_anniversary_pack`
- `dlc022_waking_the_tiger`
- `dlc023_man_the_guns`
- `dlc025_axis_armor_pack`
- `dlc026_radio_pack`
- `dlc028_la_resistance`
- `dlc029_allied_armor_pack`
- `dlc030_allied_speeches_pack`
- `dlc031_battle_for_the_bosporus`
- `dlc032_eastern_front_planes_pack`
- `dlc033_songs_of_the_eastern_front`
- `dlc034_no_step_back`
- `dlc036_by_blood_alone`
- `dlc038_arms_against_tyranny`
- `dlc040_trial_of_allegiance`
- `dlc042_content_creator_pack_soviet_union_2d_art`
- `dlc043_gotterdammerung`
- `dlc045_expansion_pass_1_supporter_pack`
- `dlc046_graveyard_of_empires`
- `dlc047_prototype_vehicles`
- `dlc048_expansion_pass_2_seaplane_tenders`
- `dlc049_no_compromise_no_surrender`

## `dlc_metadata/`
- `dlc_info`：DLC 元数据

## `gfx/`
- `3dviewenv`：3D 视图环境
- `FX`：特效资源
- `aces`：王牌相关图像
- `achievements`：成就图像
- `army_icons`：陆军图标
- `cursors`：鼠标指针
- `entities`：实体显示资源
- `event_pictures`：事件图片
- `flags`：国旗资源
- `fonts`：字体
- `game_rules`：规则图像资源
- `interface`：界面图像资源
- `keyicons`：键位图标
- `leaders`：人物头像
- `loadingscreens`：加载画面
- `maparrows`：地图箭头
- `mapitems`：地图物件
- `minimap`：小地图资源
- `models`：模型资源
- `particles`：粒子效果
- `texticons`：文字图标
- `train_gfx_database`：列车图像数据库
- `world`：世界贴图资源

## `history/`
- `countries`：国家开局历史
- `general`：通用历史参数
- `states`：州历史数据
- `units`：单位开局部署

## `integrated_dlc/`
- `dlc018_together_for_victory`：含 `interface/gfx/music/sound`（已集成扩展内容）
- `dlc020_death_or_dishonor`：含 `interface/gfx/music/sound`（已集成扩展内容）
- `dlc022_waking_the_tiger`：含 `interface/gfx/music/sound`（已集成扩展内容）
- `dlc023_man_the_guns`：含 `interface/gfx/music/sound`（已集成扩展内容）

### DLC 对当前数据抽取的影响（按目录类型）
- **高影响（建议纳入解析）**：`common`、`history`、`events`、`map`、`localisation`
- **中影响（按需求）**：`interface`（UI 展示与图标映射）
- **低影响（可不纳入核心数据）**：`gfx`、`music`、`sound`

> 说明：当前仓库脚本 `scripts/convert-hoi4-data.mjs` 主要读取本体 `common/`、`history/`、`map/` 与 `localisation/`，尚未系统合并 `dlc/*` 覆盖层。

## `interface/`
- `building_roster`：建筑列表界面
- `buildings`：建筑界面
- `career_profile`：生涯档案界面
- `doctrines`：学说界面
- `equipmentdesigner`：装备设计界面
- `factions`：阵营界面
- `integrity`：完整性相关界面组件
- `international_market`：国际市场界面
- `military_industrial_organization`：MIO 界面
- `military_raids`：军事突袭界面
- `notifications`：通知系统界面
- `pdx_online`：在线功能界面
- `special_projects`：特殊项目界面
- `widgets`：通用组件

## `localisation/`
- `braz_por`：巴葡本地化
- `english`：英文
- `french`：法文
- `german`：德文
- `japanese`：日文
- `korean`：韩文
- `polish`：波兰文
- `russian`：俄文
- `simp_chinese`：简中
- `spanish`：西班牙文

## `map/`
- `strategicregions`：战略区域
- `supplyareas`：补给区域
- `terrain`：地形定义

## `music/`
- `hoi2`：HOI2 风格音乐
- `hoi3`：HOI3 风格音乐

## `pdx_browser/`
- `locales`：浏览器语言包
- `swiftshader`：软件渲染支持库

## `pdx_launcher/`
- `common`：启动器通用资源
- `game`：启动器游戏侧资源

## `pdx_online_assets/`
- `gfx`：在线相关图形素材
- `interface`：在线相关界面素材

## `previewer_assets/`
- `assetviewer_interface`：资产预览器界面
- `gfx`：预览器图形
- `interface`：预览器界面

## `sound/`
- `animations`：动画音效配置
- `audiofiles`：音频文件集合
- `awards`：奖励/成就音效
- `gui`：界面音效
- `menu`：菜单音效
- `placeholders`：占位音频
- `weather`：天气音效

## `tools/`
- `art`：美术工具资源
- `history_viewer`：历史查看器工具

## `tweakergui_assets/`
- `gfx`：调参 GUI 图形
- `interface`：调参 GUI 界面

## `wiki/`
- `Special%3AContributions`
- `Special%3ALog`
- `Special%3ARecentChangesLinked`
- `Special%3AUndelete`
- `Special%3AWhatLinksHere`
- `Template%3AAchievement`
- `Template%3AAmbox`
- `Template%3AAnchor`
- `Template%3ACategory`
- `Template%3ACleanup`
- `Template%3ACopy_edit`
- `Template%3ACountry`
- `Template%3ACountry_navbox`
- `Template%3ACurrent`
- `Template%3ADelete`
- `Template%3ADuplicate`
- `Template%3AExpand`
- `Template%3AGreen`
- `Template%3AIcon`
- `Template%3AInUse`
- `Template%3AInfobox`
- `Template%3ALinks`
- `Template%3AMerge`
- `Template%3AMove`
- `Template%3APOV`
- `Template%3AProtect`
- `Template%3ARed`
- `Template%3ARewrite`
- `Template%3ASpeedDelete`
- `Template%3ASplit`
- `Template%3AStub`
- `Template%3ATemplate`
- `Template%3ATemplate_doc_page_transcluded`
- `Template%3AUnder_construction`
- `Template%3AUnique_national_idea_bonus_list`
- `Template%3AUnique_national_idea_bonus_table`
- `Template%3AUnsigned`
- `Template%3AUpdate`
- `Template%3AUserInfo`
- `Template%3AVersion`
- `Template%3AWikify`
- `User%3AGeneral_Baker`
- `User%3ASaintDaveUK`
- `images`
- `resources`
- `skins`

---

## 无一级子文件夹的目录
`EmptySteamDepot`、`assets`、`browser`、`country_metadata`、`documentation`、`events`、`portraits`、`script`、`tests`、`tutorial`
