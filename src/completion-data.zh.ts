/**
 * Chinese completion data, the source of completion-data.en.ts and completion-data.ug.ts. A change
 * here goes into those two files as well, with the same commands, flags and values
 * (completion-data.test.ts checks this). The format is described in completion-data.ts.
 */
import type { CommandSpec } from './completion-data'

const UNITS =
  'nginx;sshd;ssh;docker;containerd;mysql;mysqld;mariadb;postgresql;redis;redis-server;mongod;php-fpm;httpd;apache2;firewalld;ufw;cron;crond;rsyslog;chronyd;NetworkManager;systemd-networkd;systemd-resolved;systemd-journald;systemd-timesyncd;kubelet;fail2ban;supervisor;frpc;frps;smb;nfs-server;vsftpd;keepalived;haproxy;tailscaled;zerotier-one;wg-quick@wg0'
const SIGNALS =
  'TERM 正常终止 (15);KILL 强制结束 (9);HUP 挂起/重新加载 (1);INT 中断 (2);QUIT 退出 (3);USR1 用户信号 1;USR2 用户信号 2;STOP 暂停;CONT 继续'
const K8S_OUTPUT = 'wide 更多列;yaml YAML;json JSON;name 仅名称;jsonpath= JSONPath 表达式'
const K8S_RESOURCES =
  'pods 容器组;deployments 部署;services 服务;nodes 节点;namespaces 命名空间;ingress 入口;configmaps 配置;secrets 密钥;statefulsets 有状态集;daemonsets 守护集;replicasets 副本集;jobs 任务;cronjobs 定时任务;pv 持久卷;pvc 持久卷声明;events 事件;endpoints 端点;serviceaccounts 服务账号;storageclasses 存储类;hpa 自动扩缩;all 全部'
const PKG_YES = '-y|--yes 自动确认;-q|--quiet 静默'

const unit = (d: string): CommandSpec => ({ d, v: UNITS })
const path = (d: string, o?: string): CommandSpec => ({ d, p: true, o })

const GIT: CommandSpec = {
  d: '版本控制',
  o: '-C <目录> 在指定目录运行;-c <配置> 临时配置项;--version 版本;--help 帮助',
  s: {
    status: {
      d: '工作区状态',
      o: '-s|--short 简洁输出;-b|--branch 显示分支;--ignored 显示忽略的文件',
    },
    add: path(
      '暂存改动',
      '-A|--all 全部改动;-p|--patch 交互式选择片段;-u|--update 仅已跟踪文件;-f|--force 添加被忽略的文件;-n|--dry-run 仅预览',
    ),
    commit: {
      d: '提交',
      o: '-m|--message <说明> 提交说明;-a|--all 自动暂存已跟踪文件;--amend 修改上一次提交;--no-edit 沿用原说明;--allow-empty 允许空提交;-S 签名提交;-v 显示差异',
    },
    push: {
      d: '推送到远程',
      v: 'origin',
      o: '-u|--set-upstream 设置上游;--force-with-lease 安全强推;-f|--force 强制推送;--tags 推送标签;--all 推送所有分支;-d|--delete 删除远程分支;--dry-run 仅预览',
    },
    pull: {
      d: '拉取并合并',
      v: 'origin',
      o: '--rebase 变基方式合并;--ff-only 仅快进;--no-rebase 合并方式;--autostash 自动储藏',
    },
    fetch: {
      d: '获取远程更新',
      v: 'origin',
      o: '--all 所有远程;-p|--prune 清理已删除的远程分支;--tags 获取标签;--depth <深度> 浅获取',
    },
    clone: {
      d: '克隆仓库',
      o: '--depth <深度> 浅克隆;-b|--branch <分支> 指定分支;--recursive 包含子模块;--single-branch 只克隆一个分支;--bare 裸仓库',
    },
    init: { d: '初始化仓库', o: '-b|--initial-branch <分支> 初始分支名;--bare 裸仓库' },
    log: {
      d: '提交历史',
      o: '--oneline 单行显示;--graph 分支图;--all 所有分支;-n <数量> 最近 N 条;-p|--patch 显示差异;--stat 统计改动;--author= 按作者;--since= 起始时间;--until= 截止时间;--grep= 按说明搜索;--follow 跟踪改名;--decorate 显示引用',
    },
    diff: path(
      '查看差异',
      '--staged|--cached 已暂存的差异;--stat 统计;--name-only 仅文件名;--name-status 文件名和状态;-w 忽略空白;--word-diff 按词比较',
    ),
    show: { d: '显示提交内容', o: '--stat 统计;--name-only 仅文件名;--oneline 简洁' },
    checkout: path(
      '切换分支或恢复文件',
      '-b <分支> 新建并切换;-B <分支> 新建或重置并切换;-f|--force 强制',
    ),
    switch: {
      d: '切换分支',
      o: '-c|--create <分支> 新建并切换;-C <分支> 强制新建;-d|--detach 分离头指针',
    },
    branch: {
      d: '分支管理',
      o: '-a|--all 包括远程分支;-r|--remotes 远程分支;-d|--delete 删除分支;-D 强制删除;-m|--move 重命名;-v 显示最新提交;-vv 显示上游;-u|--set-upstream-to <上游> 设置上游;--merged 已合并的;--no-merged 未合并的',
    },
    merge: {
      d: '合并分支',
      o: '--no-ff 保留合并提交;--ff-only 仅快进;--squash 压缩合并;--abort 放弃合并;--continue 继续合并;-m <说明> 合并说明',
    },
    rebase: {
      d: '变基',
      o: '-i|--interactive 交互式;--continue 继续;--abort 放弃;--skip 跳过当前提交;--onto <新基> 指定新基;--autosquash 自动整理 fixup',
    },
    reset: {
      d: '重置 HEAD',
      p: true,
      v: 'HEAD;HEAD~1;HEAD^',
      o: '--soft 保留暂存和工作区;--mixed 保留工作区（默认）;--hard 丢弃所有改动;--keep 保留未提交改动',
    },
    restore: path(
      '恢复文件',
      '--staged 取消暂存;-s|--source <提交> 从指定提交恢复;-W|--worktree 恢复工作区',
    ),
    stash: {
      d: '储藏改动',
      o: '-u|--include-untracked 包括未跟踪文件;-m|--message <说明> 说明',
      s: {
        push: { d: '储藏', o: '-m|--message <说明> 说明;-u|--include-untracked 包括未跟踪文件' },
        pop: '恢复并删除最近的储藏',
        apply: '恢复储藏',
        list: '列出储藏',
        show: { d: '查看储藏', o: '-p 显示差异' },
        drop: '删除储藏',
        clear: '清空所有储藏',
        branch: '从储藏新建分支',
      },
    },
    remote: {
      d: '远程仓库',
      o: '-v|--verbose 显示地址',
      s: {
        add: '添加远程',
        remove: '删除远程',
        rename: '重命名',
        'set-url': '修改地址',
        'get-url': '查看地址',
        show: '查看详情',
        prune: '清理失效分支',
      },
    },
    tag: {
      d: '标签',
      o: '-a <标签> 附注标签;-m <说明> 标签说明;-d|--delete 删除标签;-l|--list 列出;-n 显示说明;--sort= 排序',
    },
    'cherry-pick': {
      d: '拣选提交',
      o: '--continue 继续;--abort 放弃;-n|--no-commit 不自动提交;-x 记录来源',
    },
    revert: {
      d: '撤销提交',
      o: '--no-edit 沿用默认说明;-n|--no-commit 不自动提交;--continue 继续;--abort 放弃',
    },
    clean: {
      d: '删除未跟踪文件',
      o: '-n|--dry-run 仅预览;-f|--force 执行删除;-d 包括目录;-x 包括忽略的文件;-i 交互式',
    },
    rm: path('删除并取消跟踪', '--cached 只取消跟踪;-r 递归;-f|--force 强制'),
    mv: path('移动或重命名'),
    blame: path('逐行追溯', '-L <范围> 行范围;-w 忽略空白;-C 检测复制'),
    config: {
      d: '配置',
      v: 'user.name 用户名;user.email 邮箱;core.editor 编辑器;init.defaultBranch 默认分支;pull.rebase 拉取时变基;core.autocrlf 换行转换;credential.helper 凭据存储;http.proxy 代理',
      o: '--global 全局配置;--system 系统配置;--local 仓库配置;-l|--list 列出全部;--unset 删除配置项;--get 读取配置项;-e|--edit 编辑配置',
    },
    submodule: {
      d: '子模块',
      s: {
        update: { d: '更新子模块', o: '--init 初始化;--recursive 递归;--remote 拉取最新' },
        add: '添加子模块',
        status: '查看状态',
        init: '初始化',
        sync: '同步地址',
        foreach: '逐个执行命令',
      },
    },
    bisect: {
      d: '二分查找问题提交',
      s: { start: '开始', good: '标记为正常', bad: '标记为有问题', skip: '跳过', reset: '结束' },
    },
    worktree: {
      d: '多工作区',
      s: { add: '添加工作区', list: '列出工作区', remove: '删除工作区', prune: '清理' },
    },
    lfs: {
      d: '大文件存储',
      s: {
        install: '安装钩子',
        track: '跟踪文件模式',
        'ls-files': '列出大文件',
        pull: '拉取大文件',
        push: '推送大文件',
        status: '状态',
      },
    },
    archive: { d: '导出归档', o: '--format= 格式;-o|--output <文件> 输出文件;--prefix= 路径前缀' },
    shortlog: { d: '按作者汇总', o: '-s 仅计数;-n 按数量排序;-e 显示邮箱' },
    grep: { d: '在仓库中搜索', o: '-n 显示行号;-i 忽略大小写;-w 整词匹配;-l 仅文件名' },
    describe: { d: '描述提交', o: '--tags 使用轻量标签;--always 找不到标签时输出哈希' },
    reflog: '引用日志',
    gc: '清理并压缩仓库',
  },
}
const COMPOSE: CommandSpec = {
  d: '多容器编排',
  o: '-f|--file <文件> 指定 compose 文件;-p|--project-name <名称> 项目名;--profile <配置> 启用配置;--env-file <文件> 环境变量文件',
  s: {
    up: {
      d: '创建并启动',
      o: '-d|--detach 后台运行;--build 先构建镜像;--force-recreate 强制重建;--remove-orphans 删除孤立容器;--no-deps 不启动依赖;--wait 等待健康检查',
    },
    down: {
      d: '停止并删除',
      o: '-v|--volumes 同时删除卷;--rmi <类型> 删除镜像;--remove-orphans 删除孤立容器',
    },
    ps: { d: '列出容器', o: '-a|--all 包括已停止;-q|--quiet 仅 ID;--services 仅服务名' },
    logs: {
      d: '查看日志',
      o: '-f|--follow 持续输出;--tail <行数> 最后 N 行;-t|--timestamps 时间戳;--since <时间> 起始时间',
    },
    build: { d: '构建镜像', o: '--no-cache 不使用缓存;--pull 拉取最新基础镜像' },
    exec: {
      d: '在服务中执行命令',
      o: '-T 不分配 TTY;-u|--user <用户> 以指定用户;-w|--workdir <目录> 工作目录',
    },
    run: {
      d: '运行一次性命令',
      o: '--rm 结束后删除;-d 后台;-e <变量> 环境变量;--no-deps 不启动依赖',
    },
    config: { d: '校验并显示配置', o: '--services 列出服务;-q 仅校验' },
    rm: { d: '删除已停止的容器', o: '-f 不确认;-s 先停止' },
    restart: '重启服务',
    stop: '停止服务',
    start: '启动服务',
    pull: '拉取镜像',
    push: '推送镜像',
    top: '查看进程',
    images: '列出镜像',
    kill: '强制停止',
    pause: '暂停',
    unpause: '恢复',
    ls: '列出项目',
    cp: '复制文件',
    events: '实时事件',
    version: '版本',
  },
}

const DOCKER: CommandSpec = {
  d: '容器管理',
  o: '-H|--host <地址> 守护进程地址;--context <上下文> 使用上下文;-v|--version 版本',
  s: {
    run: {
      d: '创建并运行容器',
      o: '-d|--detach 后台运行;-it 交互式终端;--rm 退出后删除;--name <名称> 容器名;-p|--publish <端口> 端口映射 主机:容器;-v|--volume <卷> 挂载 主机:容器;-e|--env <变量> 环境变量;--env-file <文件> 环境变量文件;--restart <策略> 重启策略;--network <网络> 网络;-w|--workdir <目录> 工作目录;-u|--user <用户> 运行用户;--privileged 特权模式;--entrypoint <命令> 覆盖入口;-m|--memory <大小> 内存上限;--cpus <数量> CPU 上限;--gpus <设备> 使用 GPU;--hostname <名称> 主机名;--add-host <映射> hosts 映射;-l|--label <标签> 标签',
      a: {
        '--restart': 'no 不重启;always 总是;unless-stopped 除非手动停止;on-failure 失败时',
        '--network': 'bridge 默认网桥;host 主机网络;none 无网络',
      },
    },
    ps: {
      d: '列出容器',
      o: '-a|--all 包括已停止;-q|--quiet 仅 ID;-s|--size 显示大小;-f|--filter <条件> 过滤;--format <模板> 输出格式;-n|--last <数量> 最近 N 个;--no-trunc 不截断',
    },
    exec: {
      d: '在容器内执行命令',
      o: '-it 交互式终端;-u|--user <用户> 以指定用户;-w|--workdir <目录> 工作目录;-e|--env <变量> 环境变量;-d 后台执行;--privileged 特权',
    },
    logs: {
      d: '查看日志',
      o: '-f|--follow 持续输出;--tail <行数> 最后 N 行;-t|--timestamps 时间戳;--since <时间> 起始时间;--until <时间> 截止时间',
    },
    images: {
      d: '列出镜像',
      o: '-a|--all 全部;-q|--quiet 仅 ID;--digests 摘要;-f|--filter <条件> 过滤',
    },
    pull: { d: '拉取镜像', o: '--platform <平台> 指定平台;-a|--all-tags 所有标签;-q 静默' },
    build: path(
      '构建镜像',
      '-t|--tag <名称> 镜像名:标签;-f|--file <文件> Dockerfile 路径;--no-cache 不使用缓存;--build-arg <参数> 构建参数;--platform <平台> 目标平台;--target <阶段> 构建阶段;--pull 拉取最新基础镜像',
    ),
    stop: { d: '停止容器', o: '-t|--time <秒> 等待时间' },
    kill: { d: '强制停止', o: '-s|--signal <信号> 信号' },
    rm: { d: '删除容器', o: '-f|--force 强制删除运行中的容器;-v|--volumes 同时删除匿名卷' },
    rmi: { d: '删除镜像', o: '-f|--force 强制' },
    inspect: { d: '查看详情', o: '-f|--format <模板> 输出格式' },
    stats: { d: '资源占用', o: '--no-stream 只输出一次;-a|--all 包括已停止' },
    save: { d: '导出镜像', o: '-o|--output <文件> 输出文件' },
    load: { d: '导入镜像', o: '-i|--input <文件> 输入文件' },
    push: '推送镜像',
    start: '启动容器',
    restart: '重启容器',
    top: '容器内进程',
    cp: '在容器与主机间复制',
    tag: '给镜像打标签',
    commit: '容器保存为镜像',
    login: '登录镜像仓库',
    logout: '退出登录',
    info: '系统信息',
    version: '版本',
    search: '搜索镜像',
    port: '端口映射',
    rename: '重命名容器',
    update: '更新容器配置',
    wait: '等待容器结束',
    diff: '文件变更',
    history: '镜像历史',
    events: '实时事件',
    pause: '暂停',
    unpause: '恢复',
    attach: '连接到容器',
    compose: COMPOSE,
    container: {
      d: '容器',
      s: {
        ls: '列出',
        prune: '清理已停止的容器',
        inspect: '详情',
        rm: '删除',
        stop: '停止',
        start: '启动',
        restart: '重启',
        logs: '日志',
        exec: '执行命令',
      },
    },
    image: {
      d: '镜像',
      s: {
        ls: '列出',
        prune: { d: '清理', o: '-a|--all 所有未使用的;-f|--force 不确认' },
        rm: '删除',
        inspect: '详情',
        pull: '拉取',
        push: '推送',
        tag: '打标签',
        build: '构建',
        history: '历史',
      },
    },
    volume: {
      d: '数据卷',
      s: { ls: '列出', create: '创建', rm: '删除', inspect: '详情', prune: '清理未使用的卷' },
    },
    network: {
      d: '网络',
      s: {
        ls: '列出',
        create: '创建',
        rm: '删除',
        inspect: '详情',
        connect: '连接容器',
        disconnect: '断开容器',
        prune: '清理',
      },
    },
    system: {
      d: '系统',
      s: {
        df: '磁盘占用',
        prune: { d: '清理', o: '-a|--all 所有未使用的镜像;--volumes 包括卷;-f|--force 不确认' },
        info: '系统信息',
        events: '实时事件',
      },
    },
    builder: { d: '构建缓存', s: { prune: '清理构建缓存' } },
    buildx: {
      d: '扩展构建',
      s: {
        build: '构建',
        ls: '列出构建器',
        create: '创建构建器',
        use: '切换构建器',
        prune: '清理缓存',
      },
    },
    context: {
      d: '上下文',
      s: { ls: '列出', use: '切换', create: '创建', rm: '删除', inspect: '详情' },
    },
  },
}

const K8S_NAMESPACES = 'default;kube-system;kube-public;ingress-nginx;monitoring'
const KUBECTL: CommandSpec = {
  d: 'Kubernetes 管理',
  o: '-n|--namespace <命名空间> 命名空间;-A|--all-namespaces 所有命名空间;-l|--selector <标签> 标签选择;-o|--output <格式> 输出格式;--context <上下文> 集群上下文;--kubeconfig <文件> 配置文件',
  a: { '-o': K8S_OUTPUT, '-n': K8S_NAMESPACES },
  s: {
    get: {
      d: '列出资源',
      v: K8S_RESOURCES,
      o: '-w|--watch 持续监视;--show-labels 显示标签;--sort-by= 排序字段;--field-selector= 字段过滤',
    },
    describe: { d: '资源详情', v: K8S_RESOURCES },
    logs: {
      d: '查看日志',
      o: '-f|--follow 持续输出;--tail= 最后 N 行;-c|--container <容器> 指定容器;-p|--previous 上一个实例;--since= 时间范围;--all-containers 所有容器;--timestamps 时间戳',
    },
    exec: { d: '在容器内执行命令', o: '-it 交互式终端;-c|--container <容器> 指定容器' },
    apply: {
      d: '应用配置',
      o: '-f|--filename <文件> 配置文件;-k|--kustomize <目录> kustomize 目录;--dry-run= 仅预览;--server-side 服务端应用',
    },
    delete: {
      d: '删除资源',
      v: K8S_RESOURCES,
      o: '-f|--filename <文件> 配置文件;--force 强制;--grace-period= 等待时间;--all 全部',
    },
    create: {
      d: '创建资源',
      o: '-f|--filename <文件> 配置文件;--dry-run= 仅预览',
      s: {
        namespace: '命名空间',
        deployment: '部署',
        secret: '密钥',
        configmap: '配置',
        service: '服务',
        job: '任务',
        serviceaccount: '服务账号',
      },
    },
    edit: { d: '编辑资源', v: K8S_RESOURCES },
    scale: { d: '扩缩副本', o: '--replicas= 副本数' },
    rollout: {
      d: '滚动更新',
      s: {
        status: '查看进度',
        restart: '滚动重启',
        undo: '回滚',
        history: '历史版本',
        pause: '暂停',
        resume: '继续',
      },
    },
    'port-forward': { d: '端口转发', o: '--address= 监听地址' },
    top: { d: '资源用量', s: { pod: '容器组用量', node: '节点用量' } },
    config: {
      d: '配置',
      s: {
        'get-contexts': '列出上下文',
        'use-context': '切换上下文',
        'current-context': '当前上下文',
        view: '查看配置',
        'set-context': '修改上下文',
      },
    },
    drain: {
      d: '驱逐节点',
      o: '--ignore-daemonsets 忽略守护集;--delete-emptydir-data 删除 emptyDir 数据',
    },
    auth: { d: '权限', s: { 'can-i': '检查权限', whoami: '当前身份' } },
    set: { d: '修改字段', s: { image: '更新镜像', env: '环境变量', resources: '资源限制' } },
    'cluster-info': '集群信息',
    explain: '资源字段说明',
    label: '设置标签',
    annotate: '设置注解',
    cordon: '禁止调度',
    uncordon: '恢复调度',
    taint: '设置污点',
    cp: '复制文件',
    version: '版本',
    'api-resources': '资源类型列表',
    run: '运行容器组',
    expose: '暴露为服务',
    debug: '调试',
    diff: '对比配置',
    patch: '局部更新',
    wait: '等待条件',
    events: '查看事件',
  },
}

const HELM: CommandSpec = {
  d: 'Kubernetes 包管理',
  o: '-n|--namespace <命名空间> 命名空间;-f|--values <文件> values 文件;--set <键值> 设置值;--kube-context <上下文> 集群上下文',
  a: { '-n': K8S_NAMESPACES },
  s: {
    install: {
      d: '安装',
      o: '--create-namespace 自动创建命名空间;--version <版本> 版本;--dry-run 仅预览;--wait 等待就绪',
    },
    upgrade: {
      d: '升级',
      o: '-i|--install 不存在时安装;--version <版本> 版本;--reuse-values 沿用旧值;--wait 等待就绪',
    },
    list: { d: '列出发布', o: '-A|--all-namespaces 所有命名空间;-a|--all 全部状态' },
    repo: {
      d: '仓库',
      s: { add: '添加仓库', update: '更新索引', list: '列出仓库', remove: '删除仓库' },
    },
    search: { d: '搜索', s: { repo: '在仓库中搜索', hub: '在 Artifact Hub 搜索' } },
    show: {
      d: '显示信息',
      s: { values: '默认值', chart: 'Chart 信息', readme: '说明', all: '全部' },
    },
    uninstall: '卸载',
    rollback: '回滚',
    history: '发布历史',
    status: '发布状态',
    template: '渲染模板',
    pull: '下载 Chart',
    create: '新建 Chart',
    lint: '检查 Chart',
    get: '获取发布信息',
    version: '版本',
  },
}

const SYSTEMCTL: CommandSpec = {
  d: '服务管理',
  o: '--user 用户级服务;--now 同时启动或停止;-a|--all 全部;-l|--full 不截断;--no-pager 不分页;-t|--type <类型> 单元类型;--state= 按状态过滤;--failed 仅失败的;-q|--quiet 静默;-f|--force 强制',
  a: { '-t': 'service;socket;timer;target;mount;path' },
  s: {
    status: unit('查看状态'),
    start: unit('启动'),
    stop: unit('停止'),
    restart: unit('重启'),
    reload: unit('重新加载配置'),
    'try-restart': unit('运行中则重启'),
    enable: unit('开机自启'),
    disable: unit('取消自启'),
    'is-active': unit('是否运行'),
    'is-enabled': unit('是否自启'),
    'is-failed': unit('是否失败'),
    mask: unit('屏蔽'),
    unmask: unit('取消屏蔽'),
    cat: unit('查看单元文件'),
    edit: unit('编辑覆盖配置'),
    show: unit('显示属性'),
    kill: unit('向进程发信号'),
    'reset-failed': unit('清除失败状态'),
    'list-dependencies': unit('依赖关系'),
    'daemon-reload': '重新加载单元文件',
    'list-units': '列出单元',
    'list-unit-files': '列出单元文件',
    'list-timers': '列出定时器',
    'list-sockets': '列出套接字',
    'get-default': '默认目标',
    'set-default': '设置默认目标',
    'is-system-running': '系统状态',
    reboot: '重启系统',
    poweroff: '关机',
    suspend: '挂起',
  },
}

const JOURNALCTL: CommandSpec = {
  d: '系统日志',
  o: '-u|--unit <单元> 指定服务;-f|--follow 持续输出;-n|--lines <行数> 最后 N 行;-b|--boot 本次启动;-e|--pager-end 跳到末尾;-r|--reverse 倒序;-k|--dmesg 内核日志;-p|--priority <级别> 日志级别;-S|--since <时间> 起始时间;-U|--until <时间> 截止时间;-x|--catalog 附加说明;-o|--output <格式> 输出格式;-g|--grep <模式> 搜索;--no-pager 不分页;--disk-usage 占用空间;--vacuum-size= 按大小清理;--vacuum-time= 按时间清理;--list-boots 启动记录',
  a: {
    '-u': UNITS,
    '-p': 'emerg;alert;crit;err;warning;notice;info;debug',
    '-o': 'short;short-iso;short-precise;verbose;json;json-pretty;cat',
    '-S': 'today 今天;yesterday 昨天',
    '-U': 'today 今天;now 现在',
  },
}
const APT: CommandSpec = {
  d: '软件包管理（Debian/Ubuntu）',
  o: `${PKG_YES};--no-install-recommends 不装推荐包;-f|--fix-broken 修复依赖;--reinstall 重新安装`,
  s: {
    update: '更新软件源索引',
    upgrade: '升级软件包',
    'full-upgrade': '完整升级（可删除包）',
    install: '安装',
    remove: '卸载',
    purge: '卸载并删除配置',
    autoremove: '清理无用依赖',
    search: '搜索',
    show: '详情',
    policy: '版本策略',
    'edit-sources': '编辑软件源',
    clean: '清理缓存',
    autoclean: '清理过期缓存',
    reinstall: '重新安装',
    depends: '依赖',
    rdepends: '反向依赖',
    list: { d: '列出软件包', o: '--installed 已安装;--upgradable 可升级' },
  },
}

const APT_GET: CommandSpec = {
  d: '软件包管理（Debian/Ubuntu，脚本用）',
  o: APT.o,
  s: {
    update: '更新软件源索引',
    upgrade: '升级软件包',
    'dist-upgrade': '完整升级',
    install: '安装',
    remove: '卸载',
    purge: '卸载并删除配置',
    autoremove: '清理无用依赖',
    clean: '清理缓存',
    autoclean: '清理过期缓存',
    source: '下载源码',
    download: '下载软件包',
    check: '检查依赖',
  },
}

const YUM: CommandSpec = {
  d: '软件包管理（RHEL/CentOS/Fedora）',
  o: '-y|--assumeyes 自动确认;-q|--quiet 静默;--enablerepo= 启用仓库;--disablerepo= 禁用仓库;--nogpgcheck 跳过签名检查',
  s: {
    install: '安装',
    remove: '卸载',
    update: '更新',
    upgrade: '升级',
    search: '搜索',
    info: '详情',
    makecache: '生成缓存',
    repolist: '列出仓库',
    provides: '查找提供某文件的包',
    history: '操作历史',
    reinstall: '重新安装',
    downgrade: '降级',
    groupinstall: '安装软件组',
    'check-update': '检查更新',
    autoremove: '清理无用依赖',
    localinstall: '安装本地包',
    deplist: '依赖列表',
    list: { d: '列出软件包', v: 'installed 已安装;available 可安装;updates 可更新' },
    clean: { d: '清理缓存', v: 'all 全部;packages 软件包;metadata 元数据' },
  },
}

const SCRIPTS = 'dev;build;start;test;lint;format;preview;serve;check'

const NPM: CommandSpec = {
  d: 'Node.js 包管理',
  s: {
    install: {
      d: '安装依赖',
      o: '-g|--global 全局安装;-D|--save-dev 开发依赖;-E|--save-exact 精确版本;--omit=dev 跳过开发依赖;--legacy-peer-deps 忽略 peer 冲突;--registry= 镜像源',
    },
    i: {
      d: '安装依赖（简写）',
      o: '-g|--global 全局安装;-D|--save-dev 开发依赖;-E|--save-exact 精确版本',
    },
    uninstall: { d: '卸载', o: '-g|--global 全局' },
    run: { d: '运行脚本', v: SCRIPTS },
    list: { d: '已安装的包', o: '-g|--global 全局;--depth= 层级' },
    audit: { d: '安全审计', s: { fix: '自动修复' } },
    cache: { d: '缓存', s: { clean: '清理缓存', verify: '校验缓存' } },
    config: {
      d: '配置',
      s: { get: '读取', set: '设置', list: '列出', delete: '删除' },
      v: 'registry 镜像源',
    },
    init: { d: '初始化 package.json', o: '-y|--yes 使用默认值' },
    ci: '按锁文件干净安装',
    update: '更新依赖',
    outdated: '检查过期依赖',
    start: '运行 start 脚本',
    test: '运行测试',
    exec: '执行包中的命令',
    publish: '发布',
    login: '登录',
    view: '查看包信息',
    version: '修改版本号',
    link: '本地链接',
    pack: '打包',
    prune: '清理多余的包',
    dedupe: '去重依赖',
    doctor: '环境检查',
    whoami: '当前用户',
  },
}

const PNPM: CommandSpec = {
  d: 'Node.js 包管理（pnpm）',
  s: {
    add: { d: '添加依赖', o: '-D|--save-dev 开发依赖;-g|--global 全局;-E|--save-exact 精确版本' },
    install: { d: '安装依赖', o: '--frozen-lockfile 严格按锁文件;--prod 跳过开发依赖' },
    run: { d: '运行脚本', v: SCRIPTS },
    store: { d: '存储', s: { prune: '清理未引用的包', path: '存储路径', status: '检查' } },
    remove: '删除依赖',
    update: '更新依赖',
    dev: '运行 dev 脚本',
    build: '运行 build 脚本',
    exec: '执行命令',
    dlx: '临时下载并执行',
    list: '已安装的包',
    outdated: '检查过期依赖',
    why: '为什么安装',
    init: '初始化',
  },
}

const YARN: CommandSpec = {
  d: 'Node.js 包管理（yarn）',
  s: {
    add: { d: '添加依赖', o: '-D|--dev 开发依赖;-E|--exact 精确版本' },
    global: { d: '全局包', s: { add: '全局安装', remove: '全局卸载', list: '列出全局包' } },
    cache: { d: '缓存', s: { clean: '清理缓存', dir: '缓存目录' } },
    install: '安装依赖',
    remove: '删除依赖',
    upgrade: '升级依赖',
    run: '运行脚本',
    dev: '运行 dev 脚本',
    build: '运行 build 脚本',
    info: '包信息',
    why: '为什么安装',
    init: '初始化',
    outdated: '检查过期依赖',
  },
}

const PIP: CommandSpec = {
  d: 'Python 包管理',
  s: {
    install: {
      d: '安装',
      o: '-r|--requirement <文件> 依赖文件;-U|--upgrade 升级;--user 安装到用户目录;-e|--editable <路径> 可编辑安装;-i|--index-url <地址> 镜像源;--no-cache-dir 不使用缓存;--break-system-packages 允许改动系统包',
    },
    uninstall: { d: '卸载', o: '-y|--yes 不确认;-r|--requirement <文件> 依赖文件' },
    list: { d: '已安装的包', o: '-o|--outdated 可升级的;--format= 输出格式' },
    freeze: '导出依赖列表',
    show: '包详情',
    download: '下载',
    search: '搜索',
    check: '检查依赖',
    config: '配置',
    cache: { d: '缓存', s: { purge: '清空', dir: '缓存目录', info: '信息' } },
  },
}
const CARGO: CommandSpec = {
  d: 'Rust 构建工具',
  o: '--release 发布构建;-p|--package <包> 指定包;--all-targets 所有目标;--features <特性> 启用特性;-j|--jobs <数量> 并行数',
  s: {
    build: '构建',
    run: '运行',
    test: '测试',
    check: '检查',
    clippy: '代码检查',
    fmt: '格式化',
    add: '添加依赖',
    remove: '删除依赖',
    new: '新建项目',
    init: '初始化',
    update: '更新依赖',
    clean: '清理',
    doc: '生成文档',
    install: '安装工具',
    publish: '发布',
    tree: '依赖树',
    bench: '基准测试',
  },
}

const GO: CommandSpec = {
  d: 'Go 工具链',
  s: {
    mod: {
      d: '模块',
      s: {
        tidy: '整理依赖',
        init: '初始化模块',
        download: '下载依赖',
        vendor: '复制到 vendor',
        why: '为什么依赖',
        graph: '依赖图',
      },
    },
    build: {
      d: '构建',
      o: '-o <文件> 输出文件;-v 显示包名;-race 竞态检测;-ldflags <参数> 链接参数',
    },
    test: {
      d: '测试',
      o: '-v 详细输出;-run <模式> 按名称;-cover 覆盖率;-race 竞态检测;-count= 运行次数',
    },
    run: '编译并运行',
    get: '获取依赖',
    install: '安装',
    fmt: '格式化',
    vet: '静态检查',
    env: '环境变量',
    version: '版本',
    clean: '清理',
    generate: '代码生成',
    work: '工作区',
  },
}

const TMUX: CommandSpec = {
  d: '终端复用',
  s: {
    new: { d: '新建会话', o: '-s <名称> 会话名;-d 后台创建' },
    attach: { d: '连接会话', o: '-t <会话> 目标会话;-d 断开其他客户端' },
    a: { d: '连接会话（简写）', o: '-t <会话> 目标会话' },
    'kill-session': { d: '结束会话', o: '-t <会话> 目标会话' },
    'split-window': { d: '拆分窗格', o: '-h 左右拆分;-v 上下拆分' },
    ls: '列出会话',
    'kill-server': '结束全部会话',
    'new-window': '新建窗口',
    'rename-session': '重命名会话',
    'source-file': '重新加载配置',
    detach: '断开',
  },
}

const SCREEN: CommandSpec = {
  d: '终端复用',
  o: '-S <名称> 新建命名会话;-r 恢复会话;-ls|-list 列出会话;-d 断开会话;-x 共享连接;-dmS <名称> 后台新建会话;-X <命令> 向会话发命令;-R 恢复或新建',
}

const PM2: CommandSpec = {
  d: 'Node 进程管理',
  o: '--name <名称> 进程名;-i|--instances <数量> 实例数;--watch 文件变化时重启',
  s: {
    start: '启动',
    stop: '停止',
    restart: '重启',
    reload: '零停机重载',
    delete: '删除',
    list: '列出进程',
    ls: '列出进程',
    logs: '查看日志',
    monit: '实时监控',
    save: '保存进程列表',
    startup: '开机自启',
    describe: '详情',
    flush: '清空日志',
    resurrect: '恢复已保存的进程',
  },
}

const SSH_OPTS =
  '-p <端口> 端口;-i <密钥> 私钥文件;-L <转发> 本地端口转发;-R <转发> 远程端口转发;-D <端口> SOCKS 代理;-J <跳板> 跳板机;-N 不执行命令;-f 后台运行;-v 调试输出;-o <选项> 额外选项;-A 转发认证代理;-X 转发 X11;-T 不分配终端;-t 强制分配终端;-C 压缩'

const PRIV: CommandSpec = {
  d: '以其他用户身份执行',
  c: true,
  o: '-u|--user <用户> 目标用户;-i|--login 登录 shell;-s|--shell 运行 shell;-E|--preserve-env 保留环境变量;-k 清除凭据缓存;-l|--list 列出权限;-H 设置 HOME',
}

const TAR =
  '-czvf 创建 .tar.gz;-xzvf 解压 .tar.gz;-cJvf 创建 .tar.xz;-xJvf 解压 .tar.xz;-cjvf 创建 .tar.bz2;-xjvf 解压 .tar.bz2;-xvf 解压（自动识别）;-tvf 查看内容;-cvf 创建 .tar;-C <目录> 解压到目录;-f <文件> 归档文件;--exclude= 排除;--strip-components= 去掉前几层目录;-p 保留权限;-z gzip;-J xz;-j bzip2;-v 显示过程'
const SIGNAL_OPTS =
  '-s <信号> 指定信号;-l 列出信号;-9 强制结束 (KILL);-15 正常终止 (TERM);-HUP 重新加载 (HUP)'
const SIGNAL_ARGS = { '-s': SIGNALS }
const RUNNER = (d: string, o?: string): CommandSpec => ({ d, c: true, o })
const FILE_OPS =
  '-r|-R|--recursive 递归;-f|--force 强制;-i|--interactive 覆盖前确认;-v|--verbose 显示过程'

const IP: CommandSpec = {
  d: '网络配置',
  o: '-4 仅 IPv4;-6 仅 IPv6;-br|-brief 简洁输出;-c|-color 彩色输出;-s|-stats 统计信息;-j|-json JSON 输出',
  s: {
    addr: {
      d: '地址',
      s: { show: '查看地址', add: '添加地址', del: '删除地址', flush: '清空地址' },
    },
    a: '查看地址（简写）',
    link: {
      d: '网卡',
      s: {
        show: '查看网卡',
        set: '修改网卡（up/down/mtu）',
        add: '添加虚拟网卡',
        delete: '删除网卡',
      },
    },
    route: {
      d: '路由',
      s: {
        show: '查看路由',
        add: '添加路由',
        del: '删除路由',
        get: '查询到某地址的路由',
        flush: '清空路由',
      },
    },
    r: '查看路由（简写）',
    neigh: { d: 'ARP/邻居表', s: { show: '查看', flush: '清空' } },
    rule: '策略路由规则',
    netns: {
      d: '网络命名空间',
      s: { list: '列出', add: '添加', delete: '删除', exec: '在命名空间中执行' },
    },
  },
}

const UFW: CommandSpec = {
  d: '防火墙（Ubuntu）',
  s: {
    status: { d: '查看状态', v: 'verbose 详细;numbered 带编号' },
    allow: { d: '放行', v: '22/tcp SSH;80/tcp HTTP;443/tcp HTTPS;OpenSSH;from' },
    deny: { d: '拒绝', v: 'from' },
    delete: { d: '删除规则', v: 'allow;deny' },
    default: { d: '默认策略', v: 'allow;deny;reject' },
    enable: '启用',
    disable: '停用',
    reload: '重新加载',
    reset: '重置所有规则',
    limit: '限速放行',
    logging: '日志级别',
    app: '应用配置',
  },
}

const FIREWALL_CMD: CommandSpec = {
  d: '防火墙（firewalld）',
  o: '--state 运行状态;--reload 重新加载;--permanent 永久生效;--zone= 区域;--list-all 列出当前区域;--list-ports 已放行端口;--list-services 已放行服务;--add-port= 放行端口 如 8080/tcp;--remove-port= 删除端口;--add-service= 放行服务;--remove-service= 删除服务;--get-active-zones 活动区域;--add-rich-rule= 添加富规则;--add-masquerade 启用 NAT',
}

const IPTABLES: CommandSpec = {
  d: '包过滤规则',
  o: '-L|--list 列出规则;-n|--numeric 不解析名称;-v|--verbose 详细;--line-numbers 显示序号;-t|--table <表> 指定表;-A|--append <链> 追加规则;-I|--insert <链> 插入规则;-D|--delete <链> 删除规则;-F|--flush 清空规则;-P|--policy <链> 默认策略;-p|--protocol <协议> 协议;--dport <端口> 目标端口;--sport <端口> 源端口;-s|--source <地址> 源地址;-d|--destination <地址> 目标地址;-i <网卡> 入口网卡;-o <网卡> 出口网卡;-j|--jump <动作> 动作;-m <模块> 匹配模块;-S 以命令形式列出',
  a: {
    '-t': 'filter;nat;mangle;raw',
    '-A': 'INPUT;OUTPUT;FORWARD;PREROUTING;POSTROUTING',
    '-I': 'INPUT;OUTPUT;FORWARD;PREROUTING;POSTROUTING',
    '-D': 'INPUT;OUTPUT;FORWARD;PREROUTING;POSTROUTING',
    '-P': 'INPUT;OUTPUT;FORWARD',
    '-p': 'tcp;udp;icmp;all',
    '-j': 'ACCEPT 放行;DROP 丢弃;REJECT 拒绝;LOG 记录;MASQUERADE 地址伪装;DNAT 目标地址转换;SNAT 源地址转换;RETURN 返回',
    '-m': 'state;conntrack;multiport;limit;comment',
  },
}

const OPENSSL: CommandSpec = {
  d: '证书与加密工具',
  s: {
    x509: {
      d: '证书处理',
      o: '-in <文件> 输入证书;-noout 不输出编码;-text 文本详情;-dates 有效期;-subject 主题;-issuer 签发者;-fingerprint 指纹',
    },
    req: {
      d: '证书请求',
      o: '-new 新建请求;-x509 自签名证书;-newkey <算法> 生成新密钥;-nodes 不加密私钥;-keyout <文件> 私钥输出;-out <文件> 输出;-days <天数> 有效天数;-subj <主题> 主题',
    },
    s_client: {
      d: 'TLS 客户端测试',
      o: '-connect <地址> 主机:端口;-servername <域名> SNI;-showcerts 显示证书链',
    },
    genrsa: '生成 RSA 私钥',
    genpkey: '生成私钥',
    rsa: 'RSA 密钥处理',
    rand: { d: '随机数', o: '-hex 十六进制;-base64 Base64' },
    dgst: '摘要',
    enc: '对称加密',
    passwd: '生成密码哈希',
    version: '版本',
    pkcs12: 'PKCS#12 处理',
    verify: '验证证书链',
  },
}

/** Every command the completion knows about, keyed by name. */
export const SPECS: Record<string, CommandSpec | string> = {
  git: GIT,
  docker: DOCKER,
  'docker-compose': COMPOSE,
  podman: { ...DOCKER, d: '容器管理（podman）' },
  kubectl: KUBECTL,
  k: KUBECTL,
  helm: HELM,
  systemctl: SYSTEMCTL,
  journalctl: JOURNALCTL,
  service: { d: '服务管理（SysV）', v: UNITS, o: '--status-all 所有服务状态' },
  apt: APT,
  'apt-get': APT_GET,
  yum: YUM,
  dnf: { ...YUM, d: '软件包管理（dnf）' },
  apk: {
    d: '软件包管理（Alpine）',
    s: {
      add: '安装',
      del: '卸载',
      update: '更新索引',
      upgrade: '升级',
      search: '搜索',
      info: '详情',
      list: '列出',
    },
    o: '--no-cache 不保留缓存',
  },
  pacman: {
    d: '软件包管理（Arch）',
    o: '-S 安装;-Syu 同步并升级;-R 卸载;-Rs 卸载及依赖;-Ss 搜索;-Q 已安装;-Qi 详情;--noconfirm 不确认',
  },
  snap: {
    d: 'Snap 软件包',
    s: {
      install: '安装',
      remove: '卸载',
      list: '已安装',
      find: '搜索',
      refresh: '更新',
      info: '详情',
      services: '服务',
    },
  },
  npm: NPM,
  pnpm: PNPM,
  yarn: YARN,
  npx: RUNNER('执行 npm 包中的命令', '-y|--yes 自动确认安装;-p|--package <包> 指定包'),
  pip: PIP,
  pip3: PIP,
  cargo: CARGO,
  go: GO,
  tmux: TMUX,
  screen: SCREEN,
  pm2: PM2,
  sudo: PRIV,
  doas: { ...PRIV, d: '以其他用户身份执行（doas）' },
  su: {
    d: '切换用户',
    v: 'root',
    o: '-|-l|--login 登录 shell;-c|--command <命令> 执行命令;-s|--shell <shell> 指定 shell',
  },
  watch: RUNNER(
    '周期执行命令',
    '-n|--interval <秒> 间隔;-d|--differences 高亮变化;-t|--no-title 不显示标题;-c|--color 保留颜色',
  ),
  xargs: RUNNER(
    '从输入构造参数',
    '-n|--max-args <数量> 每次参数数;-I <占位符> 替换字符串;-P|--max-procs <数量> 并行数;-0|--null 以 NUL 分隔;-r|--no-run-if-empty 无输入不执行;-t 打印命令',
  ),
  nohup: RUNNER('忽略挂断信号运行'),
  time: RUNNER('统计执行时间'),
  env: RUNNER('设置环境变量后执行', '-i|--ignore-environment 清空环境;-u|--unset <变量> 删除变量'),
  nice: RUNNER('以指定优先级运行', '-n|--adjustment <值> 优先级调整'),
  timeout: RUNNER(
    '限时运行',
    '-s|--signal <信号> 超时信号;-k|--kill-after <时长> 再等待后强制结束',
  ),
  strace: RUNNER(
    '跟踪系统调用',
    '-p <PID> 附加进程;-f 跟踪子进程;-e <表达式> 过滤;-o <文件> 输出文件;-c 统计',
  ),
  ssh: { d: '远程登录', o: SSH_OPTS },
  scp: path(
    '远程复制',
    `${SSH_OPTS.replace('-p <端口> 端口', '-P <端口> 端口')};-r 递归;-p 保留时间和权限;-l <限速> 限速 Kbit/s`,
  ),
  rsync: path(
    '同步文件',
    '-a|--archive 归档模式;-v|--verbose 详细;-z|--compress 压缩传输;-h|--human-readable 易读单位;-P 显示进度并断点续传;--progress 显示进度;--delete 删除目标多余文件;-n|--dry-run 仅预览;-e <命令> 远程 shell 如 "ssh -p 2222";--exclude= 排除;--include= 包含;--bwlimit= 限速 KB/s;-u|--update 跳过较新的文件;--partial 保留部分传输的文件',
  ),
  'ssh-keygen': {
    d: '生成 SSH 密钥',
    o: '-t <类型> 密钥类型;-b <位数> 密钥长度;-C <注释> 注释;-f <文件> 输出文件;-R <主机> 从 known_hosts 删除;-l 显示指纹;-p 修改口令;-N <口令> 新口令',
    a: { '-t': 'ed25519 推荐;rsa RSA;ecdsa ECDSA' },
  },
  'ssh-copy-id': { d: '上传公钥到服务器', o: '-i <公钥> 公钥文件;-p <端口> 端口' },
  tar: path('归档压缩', TAR),
  zip: path('压缩为 zip', '-r 递归;-q 静默;-9 最高压缩;-e 加密;-x <模式> 排除'),
  unzip: path(
    '解压 zip',
    '-d <目录> 解压到目录;-l 查看内容;-o 覆盖不询问;-q 静默;-O <编码> 文件名编码',
  ),
  gzip: path('gzip 压缩', '-d 解压;-k 保留原文件;-r 递归;-9 最高压缩;-l 查看信息'),
  gunzip: path('gzip 解压', '-k 保留原文件'),
  xz: path('xz 压缩', '-d 解压;-k 保留原文件;-T <线程> 线程数;-9 最高压缩'),
  '7z': {
    d: '7-Zip',
    s: { a: '压缩', x: '解压（保留路径）', e: '解压到当前目录', l: '查看内容', t: '测试' },
    p: true,
  },
  kill: { d: '向进程发信号', o: SIGNAL_OPTS, a: SIGNAL_ARGS },
  pkill: {
    d: '按名称发信号',
    o: `${SIGNAL_OPTS};-f 匹配完整命令行;-u <用户> 按用户;-x 精确匹配`,
    a: SIGNAL_ARGS,
  },
  killall: {
    d: '按名称结束进程',
    o: `${SIGNAL_OPTS};-u <用户> 按用户;-i 确认;-w 等待结束`,
    a: SIGNAL_ARGS,
  },
  pgrep: {
    d: '按名称查找进程',
    o: '-f 匹配完整命令行;-l 显示名称;-a 显示命令行;-u <用户> 按用户;-x 精确匹配',
  },
  ps: {
    d: '进程列表',
    v: 'aux 所有进程（BSD 风格）;-ef 所有进程（标准格式）;axjf 进程树',
    o: '-e 所有进程;-f 完整格式;-u <用户> 按用户;-p <PID> 按 PID;-o <字段> 自定义列;--sort= 排序 如 -%mem;--forest 进程树',
  },
  top: {
    d: '实时进程',
    o: '-d <秒> 刷新间隔;-p <PID> 指定进程;-u <用户> 按用户;-b 批处理模式;-n <次数> 刷新次数;-o <字段> 排序字段',
  },
  htop: {
    d: '实时进程（交互）',
    o: '-d <十分之一秒> 刷新间隔;-u <用户> 按用户;-p <PID> 指定进程;-t|--tree 树视图',
  },
  ls: path(
    '列出目录',
    '-l 详细列表;-a|--all 包括隐藏文件;-A 隐藏文件但不含 . ..;-h|--human-readable 易读大小;-t 按时间排序;-S 按大小排序;-r|--reverse 倒序;-R|--recursive 递归;-d 只列目录本身;-1 每行一个;-i 显示 inode;--color=auto 彩色;-lah 详细+隐藏+易读;-ltr 按时间升序',
  ),
  ll: path('详细列表'),
  cd: path('切换目录'),
  pwd: '当前目录',
  cat: path('输出文件内容', '-n|--number 显示行号;-A 显示不可见字符;-s 合并空行'),
  less: path('分页查看', '-N 显示行号;-S 不折行;-R 保留颜色;+F 持续跟踪'),
  more: path('分页查看'),
  head: path('查看开头', '-n|--lines <行数> 行数;-c|--bytes <字节> 字节数'),
  tail: path(
    '查看末尾',
    '-n|--lines <行数> 行数;-f 持续跟踪;-F 跟踪并处理轮转;-c|--bytes <字节> 字节数;--pid= 进程结束后退出',
  ),
  grep: path(
    '文本搜索',
    '-i|--ignore-case 忽略大小写;-r|--recursive 递归;-R 递归并跟随链接;-n|--line-number 显示行号;-v|--invert-match 反向匹配;-w|--word-regexp 整词;-l|--files-with-matches 仅文件名;-c|--count 计数;-E|--extended-regexp 扩展正则;-F|--fixed-strings 固定字符串;-o|--only-matching 仅匹配部分;-A <行数> 之后 N 行;-B <行数> 之前 N 行;-C <行数> 前后 N 行;--include= 包含文件;--exclude= 排除文件;--exclude-dir= 排除目录;--color=auto 高亮',
  ),
  find: path(
    '查找文件',
    '-name <模式> 按名称;-iname <模式> 按名称（忽略大小写）;-type <类型> 类型;-size <大小> 大小 如 +100M;-mtime <天数> 修改时间;-mmin <分钟> 修改时间（分钟）;-user <用户> 属主;-perm <权限> 权限;-maxdepth <层级> 最大深度;-mindepth <层级> 最小深度;-exec <命令> 执行命令;-delete 删除;-print0 以 NUL 分隔;-empty 空文件;-newer <文件> 比某文件新;-path <模式> 按路径;-prune 跳过目录;-not 取反',
  ),
  sed: path('流编辑', '-i 原地修改;-n 静默;-e <脚本> 脚本;-E|-r 扩展正则;-f <文件> 脚本文件'),
  awk: path('文本处理', '-F <分隔符> 字段分隔符;-v <变量> 定义变量;-f <文件> 脚本文件'),
  sort: path(
    '排序',
    '-n 按数字;-h 按易读数值;-r 倒序;-u 去重;-k <字段> 按字段;-t <分隔符> 分隔符;-V 按版本号',
  ),
  uniq: path('去重', '-c 计数;-d 仅重复的;-u 仅唯一的;-i 忽略大小写'),
  wc: path('统计', '-l 行数;-w 词数;-c 字节数;-m 字符数'),
  cut: path('截取列', '-d <分隔符> 分隔符;-f <字段> 字段;-c <范围> 字符范围'),
  tr: { d: '字符替换', o: '-d 删除字符;-s 压缩重复;-c 取补集' },
  tee: path('同时输出到文件', '-a|--append 追加'),
  diff: path('比较文件', '-u 统一格式;-r 递归;-q 仅报告是否不同;-w 忽略空白;-y 并排显示'),
  cp: path(
    '复制',
    `${FILE_OPS};-a|--archive 归档（保留属性）;-p 保留权限和时间;-u|--update 仅更新较新的;-n 不覆盖`,
  ),
  mv: path(
    '移动或重命名',
    '-f|--force 强制;-i|--interactive 覆盖前确认;-n 不覆盖;-v|--verbose 显示过程;-u|--update 仅更新较新的',
  ),
  rm: path('删除', `${FILE_OPS};-d 删除空目录;-rf 递归强制删除`),
  mkdir: path('创建目录', '-p|--parents 自动创建父目录;-m|--mode <权限> 权限;-v 显示过程'),
  rmdir: path('删除空目录', '-p 同时删除空父目录'),
  touch: path('创建文件或更新时间', '-a 仅访问时间;-m 仅修改时间;-d <时间> 指定时间'),
  ln: path('创建链接', '-s|--symbolic 符号链接;-f|--force 覆盖;-n 不跟随目标链接;-v 显示过程'),
  chmod: path('修改权限', '-R|--recursive 递归;-v 显示过程;--reference= 参照文件'),
  chown: path('修改属主', '-R|--recursive 递归;-h 修改链接本身;--reference= 参照文件'),
  chgrp: path('修改属组', '-R|--recursive 递归'),
  chattr: path('修改文件属性', '-R 递归;+i 设为不可修改;-i 取消不可修改;+a 仅追加'),
  lsattr: path('查看文件属性'),
  stat: path('文件详情', '-c|--format <格式> 输出格式;-f 文件系统信息'),
  file: path('识别文件类型'),
  realpath: path('绝对路径'),
  tree: path('目录树', '-L <层级> 最大深度;-a 包括隐藏文件;-d 仅目录;-h 易读大小;-I <模式> 排除'),
  du: path(
    '目录占用',
    '-h|--human-readable 易读单位;-s|--summarize 只显示总计;-a 包括文件;-d|--max-depth <层级> 最大深度;-c 总计;--exclude= 排除;-sh 总计（易读）',
  ),
  df: path(
    '磁盘空间',
    '-h|--human-readable 易读单位;-T|--print-type 文件系统类型;-i|--inodes inode 用量;-x <类型> 排除类型',
  ),
  free: {
    d: '内存用量',
    o: '-h|--human 易读单位;-m 以 MB;-g 以 GB;-s <秒> 持续刷新;-t 总计;-w 分开显示缓冲和缓存',
  },
  lsblk: { d: '块设备', o: '-f 文件系统;-a 全部;-o <字段> 自定义列;-p 完整路径;-d 不显示分区' },
  blkid: '块设备属性',
  mount: path('挂载', '-t <类型> 文件系统类型;-o <选项> 挂载选项;-a 挂载 fstab 全部;-l 列出挂载'),
  umount: path('卸载文件系统', '-l 延迟卸载;-f 强制'),
  fdisk: { d: '分区', o: '-l 列出分区' },
  uptime: { d: '运行时长与负载', o: '-p 易读格式;-s 开机时间' },
  uname: { d: '系统信息', o: '-a 全部;-r 内核版本;-m 架构;-n 主机名;-o 操作系统' },
  hostnamectl: { d: '主机名', s: { status: '查看', 'set-hostname': '设置主机名' } },
  timedatectl: {
    d: '时间与时区',
    s: {
      status: '查看',
      'set-timezone': {
        d: '设置时区',
        v: 'Asia/Shanghai;UTC;Asia/Hong_Kong;Asia/Tokyo;America/Los_Angeles;Europe/London',
      },
      'list-timezones': '列出时区',
      'set-ntp': { d: '自动同步', v: 'true;false' },
      'set-time': '设置时间',
    },
  },
  date: {
    d: '日期时间',
    o: '-u 世界时;-d|--date <时间> 指定时间;-s|--set <时间> 设置时间;-R RFC 5322 格式;-I ISO 8601 格式',
  },
  dmesg: {
    d: '内核日志',
    o: '-T 易读时间;-w|--follow 持续输出;-H 易读格式;-l <级别> 日志级别;-c 读取后清空',
  },
  lsof: path(
    '打开的文件',
    '-i <地址> 网络连接 如 :80;-p <PID> 按进程;-u <用户> 按用户;-n 不解析主机名;-P 不解析端口名',
  ),
  ss: {
    d: '套接字统计',
    v: '-tulnp 监听端口及进程;-tanp 所有 TCP 连接',
    o: '-t|--tcp TCP;-u|--udp UDP;-l|--listening 监听中;-n|--numeric 不解析;-p|--processes 显示进程;-a|--all 全部;-s|--summary 汇总;-4 IPv4;-6 IPv6;-e 扩展信息;-tulnp 监听端口及进程',
  },
  netstat: {
    d: '网络统计',
    o: '-t TCP;-u UDP;-l 监听中;-n 不解析;-p 显示进程;-a 全部;-r 路由表;-i 网卡;-s 统计;-tulnp 监听端口及进程',
  },
  ip: IP,
  ifconfig: { d: '网卡配置（旧）', o: '-a 全部网卡' },
  ping: {
    d: '连通性测试',
    o: '-c <次数> 次数;-i <秒> 间隔;-W <秒> 超时;-s <字节> 包大小;-4 IPv4;-6 IPv6;-q 只显示汇总',
  },
  traceroute: {
    d: '路由跟踪',
    o: '-n 不解析主机名;-I 使用 ICMP;-T 使用 TCP;-p <端口> 端口;-m <跳数> 最大跳数',
  },
  mtr: {
    d: '路由跟踪（持续）',
    o: '-r|--report 报告模式;-c <次数> 次数;-n 不解析主机名;-T 使用 TCP;-w 宽格式',
  },
  dig: {
    d: 'DNS 查询',
    v: 'A;AAAA;CNAME;MX;TXT;NS;SOA;PTR;ANY',
    o: '+short 简洁输出;+trace 跟踪解析;-x <地址> 反向解析;+noall 不显示其他段;+answer 仅显示答案',
  },
  nslookup: 'DNS 查询',
  host: 'DNS 查询',
  nc: {
    d: '网络工具（netcat）',
    o: '-z 只扫描不发数据;-v 详细;-l 监听;-p <端口> 本地端口;-u UDP;-w <秒> 超时;-k 保持监听',
  },
  telnet: '远程连接测试',
  curl: {
    d: '发送 HTTP 请求',
    o: '-X|--request <方法> 请求方法;-H|--header <头> 请求头;-d|--data <数据> 请求体;--data-raw <数据> 原样请求体;-F|--form <字段> 表单字段;-o|--output <文件> 保存到文件;-O|--remote-name 用远程文件名保存;-L|--location 跟随重定向;-I|--head 只取响应头;-i|--include 显示响应头;-s|--silent 静默;-S|--show-error 显示错误;-f|--fail 失败时返回错误码;-k|--insecure 跳过证书校验;-u|--user <账号> 认证 用户:密码;-x|--proxy <代理> 代理;-v|--verbose 详细;-w|--write-out <格式> 输出格式;--connect-timeout <秒> 连接超时;-m|--max-time <秒> 总超时;-C <偏移> 断点续传;-A|--user-agent <UA> UA;-b|--cookie <Cookie> Cookie;--compressed 请求压缩;-4 IPv4;-6 IPv6;-fsSL 静默跟随重定向（安装脚本常用）',
    a: {
      '-X': 'GET;POST;PUT;PATCH;DELETE;HEAD;OPTIONS',
      '-H': '"Content-Type: application/json";"Authorization: Bearer ";"Accept: application/json"',
    },
  },
  wget: {
    d: '下载文件',
    o: '-O <文件> 保存为;-P <目录> 保存目录;-c|--continue 断点续传;-q|--quiet 静默;-b|--background 后台;-r|--recursive 递归;--no-check-certificate 跳过证书校验;-t|--tries <次数> 重试次数;-T|--timeout <秒> 超时;--limit-rate= 限速;-i <文件> 从文件读取地址',
  },
  crontab: { d: '定时任务', o: '-e 编辑;-l 列出;-r 删除全部;-u <用户> 指定用户' },
  useradd: {
    d: '新建用户',
    o: '-m 创建主目录;-s <shell> 登录 shell;-G <组> 附加组;-g <组> 主组;-d <目录> 主目录;-u <UID> 指定 UID;-r 系统用户;-c <说明> 说明',
    a: { '-s': '/bin/bash;/bin/sh;/usr/sbin/nologin;/bin/zsh' },
  },
  usermod: {
    d: '修改用户',
    o: '-aG <组> 加入附加组;-s <shell> 登录 shell;-L 锁定;-U 解锁;-d <目录> 主目录;-l <新名> 重命名',
    a: { '-aG': 'sudo;wheel;docker;adm', '-s': '/bin/bash;/bin/sh;/usr/sbin/nologin;/bin/zsh' },
  },
  userdel: { d: '删除用户', o: '-r 同时删除主目录;-f 强制' },
  groupadd: '新建用户组',
  passwd: { d: '修改密码', o: '-l 锁定;-u 解锁;-d 删除密码;-e 下次登录强制修改;-S 状态' },
  id: '用户和组 ID',
  whoami: '当前用户',
  who: '登录用户',
  w: '登录用户及活动',
  last: { d: '登录历史', o: '-n <数量> 最近 N 条;-x 包括关机重启' },
  history: { d: '命令历史', o: '-c 清空;-d <序号> 删除一条;-w 写入文件' },
  alias: '命令别名',
  export: '导出环境变量',
  source: path('在当前 shell 执行脚本'),
  echo: { d: '输出文本', o: '-n 不换行;-e 解析转义' },
  printf: '格式化输出',
  which: '查找命令位置',
  whereis: '查找程序、源码和手册',
  type: '命令类型',
  man: '查看手册',
  clear: '清屏',
  exit: '退出',
  reboot: '重启',
  shutdown: { d: '关机', v: 'now 立即;+10 10 分钟后', o: '-h 关机;-r 重启;-c 取消' },
  nginx: {
    d: 'Nginx',
    o: '-t 检查配置;-T 检查并输出配置;-s <信号> 发送信号;-c <文件> 指定配置文件;-v 版本;-V 版本及编译参数',
    a: { '-s': 'reload 重新加载;stop 立即停止;quit 正常退出;reopen 重新打开日志' },
  },
  mysql: {
    d: 'MySQL 客户端',
    o: '-u|--user <用户> 用户;-p|--password 提示输入密码;-h|--host <主机> 主机;-P|--port <端口> 端口;-D|--database <库> 数据库;-e|--execute <SQL> 执行语句;--default-character-set= 字符集',
  },
  mysqldump: {
    d: 'MySQL 导出',
    o: '-u|--user <用户> 用户;-p|--password 提示输入密码;-h|--host <主机> 主机;--all-databases 所有库;--single-transaction 一致性快照;--routines 包括存储过程;--no-data 仅结构;-r|--result-file <文件> 输出文件',
  },
  psql: {
    d: 'PostgreSQL 客户端',
    o: '-U|--username <用户> 用户;-h|--host <主机> 主机;-p|--port <端口> 端口;-d|--dbname <库> 数据库;-c|--command <SQL> 执行语句;-f|--file <文件> 执行脚本;-l|--list 列出数据库',
  },
  'redis-cli': {
    d: 'Redis 客户端',
    o: '-h <主机> 主机;-p <端口> 端口;-a <密码> 密码;-n <库> 数据库编号;--scan 遍历键;--pattern <模式> 键模式;--bigkeys 查找大键;--latency 延迟测试;--stat 实时统计;-c 集群模式',
    v: 'ping;info;monitor;dbsize;flushdb;keys;get;set;del;ttl;config',
  },
  python3: path(
    'Python',
    '-m <模块> 运行模块;-c <代码> 执行代码;-V|--version 版本;-u 不缓冲输出;-i 执行后进入交互',
  ),
  python: path('Python', '-m <模块> 运行模块;-c <代码> 执行代码;-V|--version 版本'),
  node: path(
    'Node.js',
    '-e|--eval <代码> 执行代码;-v|--version 版本;--inspect 调试;-r|--require <模块> 预加载模块;--max-old-space-size= 内存上限',
  ),
  bash: path('Bash', '-c <命令> 执行命令;-x 显示执行过程;-n 只检查语法;-l 登录 shell'),
  sh: path('Shell', '-c <命令> 执行命令;-x 显示执行过程'),
  vim: path('Vim 编辑器', '-R 只读;-O 左右分屏打开;-d 对比模式'),
  vi: path('Vi 编辑器'),
  nano: path('Nano 编辑器', '-l 显示行号;-w 不自动折行;-v 只读'),
  'iptables-save': '导出防火墙规则',
  'iptables-restore': path('导入防火墙规则'),
  ufw: UFW,
  'firewall-cmd': FIREWALL_CMD,
  iptables: IPTABLES,
  ip6tables: { ...IPTABLES, d: '包过滤规则（IPv6）' },
  openssl: OPENSSL,
  certbot: {
    d: '申请 HTTPS 证书',
    s: {
      certonly: '仅申请证书',
      renew: { d: '续期', o: '--dry-run 仅测试' },
      certificates: '列出证书',
      delete: '删除证书',
      revoke: '吊销证书',
    },
    o: '--nginx 使用 Nginx 插件;--standalone 独立模式;--webroot 网站根目录模式;-d <域名> 域名;-w <目录> 网站根目录;--email <邮箱> 邮箱;--agree-tos 同意协议;-n|--non-interactive 非交互',
  },
}
