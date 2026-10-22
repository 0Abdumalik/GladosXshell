/**
 * English completion data. Same structure as completion-data.zh.ts (completion-data.test.ts
 * checks that commands, flags and values match); only descriptions and value names differ.
 */
import type { CommandSpec } from './completion-data'

const UNITS =
  'nginx;sshd;ssh;docker;containerd;mysql;mysqld;mariadb;postgresql;redis;redis-server;mongod;php-fpm;httpd;apache2;firewalld;ufw;cron;crond;rsyslog;chronyd;NetworkManager;systemd-networkd;systemd-resolved;systemd-journald;systemd-timesyncd;kubelet;fail2ban;supervisor;frpc;frps;smb;nfs-server;vsftpd;keepalived;haproxy;tailscaled;zerotier-one;wg-quick@wg0'
const SIGNALS =
  'TERM Terminate gracefully (15);KILL Force kill (9);HUP Hangup/reload (1);INT Interrupt (2);QUIT Quit (3);USR1 User signal 1;USR2 User signal 2;STOP Pause;CONT Continue'
const K8S_OUTPUT =
  'wide More columns;yaml YAML;json JSON;name Names only;jsonpath= JSONPath expression'
const K8S_RESOURCES =
  'pods Pods;deployments Deployments;services Services;nodes Nodes;namespaces Namespaces;ingress Ingress rules;configmaps Config maps;secrets Secrets;statefulsets Stateful sets;daemonsets Daemon sets;replicasets Replica sets;jobs Jobs;cronjobs Cron jobs;pv Persistent volumes;pvc Persistent volume claims;events Events;endpoints Endpoints;serviceaccounts Service accounts;storageclasses Storage classes;hpa Autoscalers;all All'
const PKG_YES = '-y|--yes Assume yes;-q|--quiet Quiet'

const unit = (d: string): CommandSpec => ({ d, v: UNITS })
const path = (d: string, o?: string): CommandSpec => ({ d, p: true, o })

const GIT: CommandSpec = {
  d: 'Version control',
  o: '-C <dir> Run in the given folder;-c <config> Set a config value for this run;--version Version;--help Help',
  s: {
    status: {
      d: 'Working tree status',
      o: '-s|--short Short output;-b|--branch Show branch;--ignored Show ignored files',
    },
    add: path(
      'Stage changes',
      '-A|--all All changes;-p|--patch Choose hunks interactively;-u|--update Tracked files only;-f|--force Add ignored files;-n|--dry-run Dry run',
    ),
    commit: {
      d: 'Commit changes',
      o: '-m|--message <message> Commit message;-a|--all Stage tracked files automatically;--amend Amend the last commit;--no-edit Keep the existing message;--allow-empty Allow an empty commit;-S Sign the commit;-v Show diff',
    },
    push: {
      d: 'Push to remote',
      v: 'origin',
      o: '-u|--set-upstream Set upstream;--force-with-lease Safer force push;-f|--force Force push;--tags Push tags;--all Push all branches;-d|--delete Delete remote branch;--dry-run Dry run',
    },
    pull: {
      d: 'Fetch and merge',
      v: 'origin',
      o: '--rebase Rebase instead of merging;--ff-only Fast-forward only;--no-rebase Merge instead of rebasing;--autostash Stash changes automatically',
    },
    fetch: {
      d: 'Fetch remote updates',
      v: 'origin',
      o: '--all All remotes;-p|--prune Prune deleted remote branches;--tags Fetch tags;--depth <depth> Shallow fetch',
    },
    clone: {
      d: 'Clone a repository',
      o: '--depth <depth> Shallow clone;-b|--branch <branch> Branch to check out;--recursive Include submodules;--single-branch Clone a single branch;--bare Bare repository',
    },
    init: {
      d: 'Initialize a repository',
      o: '-b|--initial-branch <branch> Initial branch name;--bare Bare repository',
    },
    log: {
      d: 'Commit history',
      o: '--oneline One line per commit;--graph Branch graph;--all All branches;-n <count> Last N entries;-p|--patch Show diff;--stat Change stats;--author= By author;--since= Start time;--until= End time;--grep= Search commit messages;--follow Follow renames;--decorate Show ref names',
    },
    diff: path(
      'Show changes',
      '--staged|--cached Staged changes;--stat Statistics;--name-only File names only;--name-status File names and status;-w Ignore whitespace;--word-diff Word diff',
    ),
    show: {
      d: 'Show a commit',
      o: '--stat Statistics;--name-only File names only;--oneline Short format',
    },
    checkout: path(
      'Switch branches or restore files',
      '-b <branch> Create and switch;-B <branch> Create or reset and switch;-f|--force Force',
    ),
    switch: {
      d: 'Switch branches',
      o: '-c|--create <branch> Create and switch;-C <branch> Force create;-d|--detach Detach HEAD',
    },
    branch: {
      d: 'Manage branches',
      o: '-a|--all Include remote branches;-r|--remotes Remote branches;-d|--delete Delete branch;-D Force delete;-m|--move Rename;-v Show latest commit;-vv Show upstream;-u|--set-upstream-to <upstream> Set upstream;--merged Merged;--no-merged Not merged',
    },
    merge: {
      d: 'Merge branches',
      o: '--no-ff Always create a merge commit;--ff-only Fast-forward only;--squash Squash merge;--abort Abort merge;--continue Continue merge;-m <message> Merge message',
    },
    rebase: {
      d: 'Rebase',
      o: '-i|--interactive Interactive;--continue Continue;--abort Abort;--skip Skip current commit;--onto <newbase> New base;--autosquash Auto-squash fixup commits',
    },
    reset: {
      d: 'Reset HEAD',
      p: true,
      v: 'HEAD;HEAD~1;HEAD^',
      o: '--soft Keep staged changes and working tree;--mixed Keep working tree (default);--hard Discard all changes;--keep Keep uncommitted changes',
    },
    restore: path(
      'Restore files',
      '--staged Unstage;-s|--source <commit> Restore from commit;-W|--worktree Restore working tree',
    ),
    stash: {
      d: 'Stash changes',
      o: '-u|--include-untracked Include untracked files;-m|--message <message> Message',
      s: {
        push: {
          d: 'Stash',
          o: '-m|--message <message> Message;-u|--include-untracked Include untracked files',
        },
        pop: 'Apply and drop the latest stash',
        apply: 'Apply a stash',
        list: 'List stashes',
        show: { d: 'Show a stash', o: '-p Show diff' },
        drop: 'Drop a stash',
        clear: 'Clear all stashes',
        branch: 'Create a branch from a stash',
      },
    },
    remote: {
      d: 'Remote repositories',
      o: '-v|--verbose Show URLs',
      s: {
        add: 'Add a remote',
        remove: 'Remove a remote',
        rename: 'Rename',
        'set-url': 'Change URL',
        'get-url': 'Show URL',
        show: 'Show details',
        prune: 'Prune stale branches',
      },
    },
    tag: {
      d: 'Tags',
      o: '-a <tag> Annotated tag;-m <message> Tag message;-d|--delete Delete tag;-l|--list List;-n Show messages;--sort= Sort',
    },
    'cherry-pick': {
      d: 'Cherry-pick commits',
      o: '--continue Continue;--abort Abort;-n|--no-commit Do not commit automatically;-x Record the source commit',
    },
    revert: {
      d: 'Revert commits',
      o: '--no-edit Use the default message;-n|--no-commit Do not commit automatically;--continue Continue;--abort Abort',
    },
    clean: {
      d: 'Remove untracked files',
      o: '-n|--dry-run Dry run;-f|--force Actually delete;-d Include directories;-x Include ignored files;-i Interactive',
    },
    rm: path(
      'Remove and stop tracking',
      '--cached Stop tracking only;-r Recursive;-f|--force Force',
    ),
    mv: path('Move or rename'),
    blame: path(
      'Show who changed each line',
      '-L <range> Line range;-w Ignore whitespace;-C Detect copied lines',
    ),
    config: {
      d: 'Configuration',
      v: 'user.name User name;user.email Email;core.editor Editor;init.defaultBranch Default branch;pull.rebase Rebase on pull;core.autocrlf Line ending conversion;credential.helper Credential store;http.proxy Proxy',
      o: '--global Global config;--system System config;--local Repository config;-l|--list List all;--unset Remove a setting;--get Read a setting;-e|--edit Edit config',
    },
    submodule: {
      d: 'Submodules',
      s: {
        update: {
          d: 'Update submodules',
          o: '--init Initialize;--recursive Recursive;--remote Fetch latest',
        },
        add: 'Add a submodule',
        status: 'Show status',
        init: 'Initialize',
        sync: 'Sync URLs',
        foreach: 'Run a command in each',
      },
    },
    bisect: {
      d: 'Binary search for a bad commit',
      s: {
        start: 'Start',
        good: 'Mark as good',
        bad: 'Mark as bad',
        skip: 'Skip',
        reset: 'Finish',
      },
    },
    worktree: {
      d: 'Multiple worktrees',
      s: {
        add: 'Add a worktree',
        list: 'List worktrees',
        remove: 'Remove a worktree',
        prune: 'Clean up',
      },
    },
    lfs: {
      d: 'Large file storage',
      s: {
        install: 'Install hooks',
        track: 'Track file patterns',
        'ls-files': 'List large files',
        pull: 'Pull large files',
        push: 'Push large files',
        status: 'Status',
      },
    },
    archive: {
      d: 'Export an archive',
      o: '--format= Format;-o|--output <file> Output file;--prefix= Path prefix',
    },
    shortlog: { d: 'Summarize by author', o: '-s Count only;-n Sort by count;-e Show email' },
    grep: {
      d: 'Search the repository',
      o: '-n Show line numbers;-i Ignore case;-w Match whole words;-l File names only',
    },
    describe: {
      d: 'Describe a commit',
      o: '--tags Use lightweight tags;--always Show the hash if no tag is found',
    },
    reflog: 'Reference log',
    gc: 'Clean up and compress the repository',
  },
}
const COMPOSE: CommandSpec = {
  d: 'Multi-container orchestration',
  o: '-f|--file <file> Compose file to use;-p|--project-name <name> Project name;--profile <config> Enable a profile;--env-file <file> Environment file',
  s: {
    up: {
      d: 'Create and start',
      o: '-d|--detach Run in background;--build Build images first;--force-recreate Force recreate;--remove-orphans Remove orphan containers;--no-deps Do not start dependencies;--wait Wait for health checks',
    },
    down: {
      d: 'Stop and remove',
      o: '-v|--volumes Also remove volumes;--rmi <type> Remove images;--remove-orphans Remove orphan containers',
    },
    ps: {
      d: 'List containers',
      o: '-a|--all Include stopped;-q|--quiet IDs only;--services Service names only',
    },
    logs: {
      d: 'Show logs',
      o: '-f|--follow Follow output;--tail <lines> Last N lines;-t|--timestamps Timestamps;--since <time> Start time',
    },
    build: { d: 'Build an image', o: '--no-cache Do not use cache;--pull Pull latest base image' },
    exec: {
      d: 'Run a command in a service',
      o: '-T Do not allocate a TTY;-u|--user <user> Run as this user;-w|--workdir <dir> Working directory',
    },
    run: {
      d: 'Run a one-off command',
      o: '--rm Remove when done;-d Background;-e <var> Environment variable;--no-deps Do not start dependencies',
    },
    config: { d: 'Validate and show config', o: '--services List services;-q Validate only' },
    rm: { d: 'Remove stopped containers', o: '-f No confirmation;-s Stop first' },
    restart: 'Restart services',
    stop: 'Stop services',
    start: 'Start services',
    pull: 'Pull images',
    push: 'Push images',
    top: 'Show processes',
    images: 'List images',
    kill: 'Force stop',
    pause: 'Pause',
    unpause: 'Resume',
    ls: 'List projects',
    cp: 'Copy files',
    events: 'Live events',
    version: 'Version',
  },
}

const DOCKER: CommandSpec = {
  d: 'Container management',
  o: '-H|--host <address> Daemon address;--context <context> Use a context;-v|--version Version',
  s: {
    run: {
      d: 'Create and run a container',
      o: '-d|--detach Run in background;-it Interactive terminal;--rm Remove on exit;--name <name> Container name;-p|--publish <port> Port mapping host:container;-v|--volume <volume> Mount host:container;-e|--env <var> Environment variable;--env-file <file> Environment file;--restart <policy> Restart policy;--network <network> Network;-w|--workdir <dir> Working directory;-u|--user <user> User to run as;--privileged Privileged mode;--entrypoint <command> Override entrypoint;-m|--memory <size> Memory limit;--cpus <count> CPU limit;--gpus <device> Use GPUs;--hostname <name> Hostname;--add-host <mapping> Add a hosts entry;-l|--label <tag> Label',
      a: {
        '--restart':
          'no Never restart;always Always;unless-stopped Unless stopped manually;on-failure On failure',
        '--network': 'bridge Default bridge;host Host network;none No network',
      },
    },
    ps: {
      d: 'List containers',
      o: '-a|--all Include stopped;-q|--quiet IDs only;-s|--size Show size;-f|--filter <condition> Filter;--format <template> Output format;-n|--last <count> Last N;--no-trunc Do not truncate',
    },
    exec: {
      d: 'Run a command in a container',
      o: '-it Interactive terminal;-u|--user <user> Run as this user;-w|--workdir <dir> Working directory;-e|--env <var> Environment variable;-d Run in background;--privileged Privileged',
    },
    logs: {
      d: 'Show logs',
      o: '-f|--follow Follow output;--tail <lines> Last N lines;-t|--timestamps Timestamps;--since <time> Start time;--until <time> End time',
    },
    images: {
      d: 'List images',
      o: '-a|--all All;-q|--quiet IDs only;--digests Show digests;-f|--filter <condition> Filter',
    },
    pull: { d: 'Pull images', o: '--platform <platform> Platform;-a|--all-tags All tags;-q Quiet' },
    build: path(
      'Build an image',
      '-t|--tag <name> Image name:tag;-f|--file <file> Dockerfile path;--no-cache Do not use cache;--build-arg <arg> Build argument;--platform <platform> Target platform;--target <stage> Build stage;--pull Pull latest base image',
    ),
    stop: { d: 'Stop containers', o: '-t|--time <seconds> Seconds to wait' },
    kill: { d: 'Force stop', o: '-s|--signal <signal> Signal' },
    rm: {
      d: 'Remove containers',
      o: '-f|--force Force remove running containers;-v|--volumes Also remove anonymous volumes',
    },
    rmi: { d: 'Remove images', o: '-f|--force Force' },
    inspect: { d: 'Show details', o: '-f|--format <template> Output format' },
    stats: { d: 'Resource usage', o: '--no-stream Print once;-a|--all Include stopped' },
    save: { d: 'Export images', o: '-o|--output <file> Output file' },
    load: { d: 'Import images', o: '-i|--input <file> Input file' },
    push: 'Push images',
    start: 'Start containers',
    restart: 'Restart containers',
    top: 'Processes in a container',
    cp: 'Copy between container and host',
    tag: 'Tag an image',
    commit: 'Save a container as an image',
    login: 'Log in to a registry',
    logout: 'Log out',
    info: 'System info',
    version: 'Version',
    search: 'Search images',
    port: 'Port mappings',
    rename: 'Rename container',
    update: 'Update container config',
    wait: 'Wait for container to exit',
    diff: 'File changes',
    history: 'Image history',
    events: 'Live events',
    pause: 'Pause',
    unpause: 'Resume',
    attach: 'Attach to container',
    compose: COMPOSE,
    container: {
      d: 'Containers',
      s: {
        ls: 'List',
        prune: 'Remove stopped containers',
        inspect: 'Details',
        rm: 'Remove',
        stop: 'Stop',
        start: 'Start',
        restart: 'Restart',
        logs: 'Logs',
        exec: 'Run a command',
      },
    },
    image: {
      d: 'Images',
      s: {
        ls: 'List',
        prune: { d: 'Clean up', o: '-a|--all All unused;-f|--force No confirmation' },
        rm: 'Remove',
        inspect: 'Details',
        pull: 'Pull',
        push: 'Push',
        tag: 'Tag',
        build: 'Build',
        history: 'History',
      },
    },
    volume: {
      d: 'Volumes',
      s: {
        ls: 'List',
        create: 'Create',
        rm: 'Remove',
        inspect: 'Details',
        prune: 'Remove unused volumes',
      },
    },
    network: {
      d: 'Networks',
      s: {
        ls: 'List',
        create: 'Create',
        rm: 'Remove',
        inspect: 'Details',
        connect: 'Connect a container',
        disconnect: 'Disconnect a container',
        prune: 'Clean up',
      },
    },
    system: {
      d: 'System',
      s: {
        df: 'Disk usage',
        prune: {
          d: 'Clean up',
          o: '-a|--all All unused images;--volumes Include volumes;-f|--force No confirmation',
        },
        info: 'System info',
        events: 'Live events',
      },
    },
    builder: { d: 'Build cache', s: { prune: 'Remove build cache' } },
    buildx: {
      d: 'Extended build',
      s: {
        build: 'Build',
        ls: 'List builders',
        create: 'Create builder',
        use: 'Switch builder',
        prune: 'Clear cache',
      },
    },
    context: {
      d: 'Contexts',
      s: { ls: 'List', use: 'Switch', create: 'Create', rm: 'Remove', inspect: 'Details' },
    },
  },
}

const K8S_NAMESPACES = 'default;kube-system;kube-public;ingress-nginx;monitoring'
const KUBECTL: CommandSpec = {
  d: 'Kubernetes management',
  o: '-n|--namespace <namespace> Namespace;-A|--all-namespaces All namespaces;-l|--selector <tag> Label selector;-o|--output <format> Output format;--context <context> Cluster context;--kubeconfig <file> Config file',
  a: { '-o': K8S_OUTPUT, '-n': K8S_NAMESPACES },
  s: {
    get: {
      d: 'List resources',
      v: K8S_RESOURCES,
      o: '-w|--watch Watch for changes;--show-labels Show labels;--sort-by= Sort by field;--field-selector= Filter by field',
    },
    describe: { d: 'Describe resources', v: K8S_RESOURCES },
    logs: {
      d: 'Show logs',
      o: '-f|--follow Follow output;--tail= Last N lines;-c|--container <container> Target container;-p|--previous Previous instance;--since= Time range;--all-containers All containers;--timestamps Timestamps',
    },
    exec: {
      d: 'Run a command in a container',
      o: '-it Interactive terminal;-c|--container <container> Target container',
    },
    apply: {
      d: 'Apply config',
      o: '-f|--filename <file> Config file;-k|--kustomize <dir> kustomize folder;--dry-run= Dry run;--server-side Server-side apply',
    },
    delete: {
      d: 'Delete resources',
      v: K8S_RESOURCES,
      o: '-f|--filename <file> Config file;--force Force;--grace-period= Grace period;--all All',
    },
    create: {
      d: 'Create resources',
      o: '-f|--filename <file> Config file;--dry-run= Dry run',
      s: {
        namespace: 'Namespace',
        deployment: 'Deployment',
        secret: 'Secret',
        configmap: 'Configuration',
        service: 'Service',
        job: 'Job',
        serviceaccount: 'Service account',
      },
    },
    edit: { d: 'Edit resources', v: K8S_RESOURCES },
    scale: { d: 'Scale replicas', o: '--replicas= Replica count' },
    rollout: {
      d: 'Manage rollouts',
      s: {
        status: 'Rollout status',
        restart: 'Rolling restart',
        undo: 'Roll back',
        history: 'Revision history',
        pause: 'Pause',
        resume: 'Resume',
      },
    },
    'port-forward': { d: 'Port forwarding', o: '--address= Listen address' },
    top: { d: 'Resource usage', s: { pod: 'Pod usage', node: 'Node usage' } },
    config: {
      d: 'Configuration',
      s: {
        'get-contexts': 'List contexts',
        'use-context': 'Switch context',
        'current-context': 'Current context',
        view: 'View config',
        'set-context': 'Set context',
      },
    },
    drain: {
      d: 'Drain node',
      o: '--ignore-daemonsets Ignore DaemonSets;--delete-emptydir-data Delete emptyDir data',
    },
    auth: { d: 'Authorization', s: { 'can-i': 'Check permissions', whoami: 'Current identity' } },
    set: {
      d: 'Set fields',
      s: { image: 'Update image', env: 'Environment variables', resources: 'Resource limits' },
    },
    'cluster-info': 'Cluster info',
    explain: 'Explain resource fields',
    label: 'Set labels',
    annotate: 'Set annotations',
    cordon: 'Mark unschedulable',
    uncordon: 'Mark schedulable',
    taint: 'Set taints',
    cp: 'Copy files',
    version: 'Version',
    'api-resources': 'List resource types',
    run: 'Run a pod',
    expose: 'Expose as a service',
    debug: 'Debug',
    diff: 'Diff config',
    patch: 'Patch',
    wait: 'Wait for a condition',
    events: 'Show events',
  },
}

const HELM: CommandSpec = {
  d: 'Kubernetes package manager',
  o: '-n|--namespace <namespace> Namespace;-f|--values <file> values file;--set <key=value> Set values;--kube-context <context> Cluster context',
  a: { '-n': K8S_NAMESPACES },
  s: {
    install: {
      d: 'Install',
      o: '--create-namespace Create namespace if missing;--version <version> Version;--dry-run Dry run;--wait Wait until ready',
    },
    upgrade: {
      d: 'Upgrade',
      o: '-i|--install Install if missing;--version <version> Version;--reuse-values Reuse previous values;--wait Wait until ready',
    },
    list: { d: 'List releases', o: '-A|--all-namespaces All namespaces;-a|--all All statuses' },
    repo: {
      d: 'Repositories',
      s: {
        add: 'Add repository',
        update: 'Update index',
        list: 'List repositories',
        remove: 'Remove repository',
      },
    },
    search: { d: 'Search', s: { repo: 'Search the repository', hub: 'Search Artifact Hub' } },
    show: {
      d: 'Show info',
      s: { values: 'Default values', chart: 'Chart info', readme: 'README', all: 'All' },
    },
    uninstall: 'Uninstall',
    rollback: 'Roll back',
    history: 'Release history',
    status: 'Release status',
    template: 'Render templates',
    pull: 'Download a chart',
    create: 'Create a chart',
    lint: 'Lint a chart',
    get: 'Get release info',
    version: 'Version',
  },
}

const SYSTEMCTL: CommandSpec = {
  d: 'Service manager',
  o: '--user User services;--now Also start or stop now;-a|--all All;-l|--full Do not truncate;--no-pager No pager;-t|--type <type> Unit type;--state= Filter by state;--failed Failed only;-q|--quiet Quiet;-f|--force Force',
  a: { '-t': 'service;socket;timer;target;mount;path' },
  s: {
    status: unit('Show status'),
    start: unit('Start'),
    stop: unit('Stop'),
    restart: unit('Restart'),
    reload: unit('Reload config'),
    'try-restart': unit('Restart if running'),
    enable: unit('Enable at boot'),
    disable: unit('Disable at boot'),
    'is-active': unit('Check if active'),
    'is-enabled': unit('Check if enabled'),
    'is-failed': unit('Check if failed'),
    mask: unit('Mask'),
    unmask: unit('Unmask'),
    cat: unit('Show unit file'),
    edit: unit('Edit override config'),
    show: unit('Show properties'),
    kill: unit('Send a signal to processes'),
    'reset-failed': unit('Reset failed state'),
    'list-dependencies': unit('List dependencies'),
    'daemon-reload': 'Reload unit files',
    'list-units': 'List units',
    'list-unit-files': 'List unit files',
    'list-timers': 'List timers',
    'list-sockets': 'List sockets',
    'get-default': 'Default target',
    'set-default': 'Set default target',
    'is-system-running': 'System state',
    reboot: 'Reboot',
    poweroff: 'Power off',
    suspend: 'Suspend',
  },
}

const JOURNALCTL: CommandSpec = {
  d: 'System journal',
  o: '-u|--unit <unit> Filter by service;-f|--follow Follow output;-n|--lines <lines> Last N lines;-b|--boot Current boot;-e|--pager-end Jump to end;-r|--reverse Newest first;-k|--dmesg Kernel log;-p|--priority <level> Log level;-S|--since <time> Start time;-U|--until <time> End time;-x|--catalog Add explanations;-o|--output <format> Output format;-g|--grep <pattern> Search;--no-pager No pager;--disk-usage Disk usage;--vacuum-size= Vacuum by size;--vacuum-time= Vacuum by age;--list-boots List boots',
  a: {
    '-u': UNITS,
    '-p': 'emerg;alert;crit;err;warning;notice;info;debug',
    '-o': 'short;short-iso;short-precise;verbose;json;json-pretty;cat',
    '-S': 'today Today;yesterday Yesterday',
    '-U': 'today Today;now Now',
  },
}
const APT: CommandSpec = {
  d: 'Package manager (Debian/Ubuntu)',
  o: `${PKG_YES};--no-install-recommends Skip recommended packages;-f|--fix-broken Fix broken dependencies;--reinstall Reinstall`,
  s: {
    update: 'Update package index',
    upgrade: 'Upgrade packages',
    'full-upgrade': 'Full upgrade (may remove packages)',
    install: 'Install',
    remove: 'Uninstall',
    purge: 'Remove with config files',
    autoremove: 'Remove unused dependencies',
    search: 'Search',
    show: 'Details',
    policy: 'Version policy',
    'edit-sources': 'Edit sources',
    clean: 'Clear cache',
    autoclean: 'Clear outdated cache',
    reinstall: 'Reinstall',
    depends: 'Dependencies',
    rdepends: 'Reverse dependencies',
    list: { d: 'List packages', o: '--installed Installed;--upgradable Upgradable' },
  },
}

const APT_GET: CommandSpec = {
  d: 'Package manager (Debian/Ubuntu, for scripts)',
  o: APT.o,
  s: {
    update: 'Update package index',
    upgrade: 'Upgrade packages',
    'dist-upgrade': 'Full upgrade',
    install: 'Install',
    remove: 'Uninstall',
    purge: 'Remove with config files',
    autoremove: 'Remove unused dependencies',
    clean: 'Clear cache',
    autoclean: 'Clear outdated cache',
    source: 'Download source code',
    download: 'Download packages',
    check: 'Check dependencies',
  },
}

const YUM: CommandSpec = {
  d: 'Package manager (RHEL/CentOS/Fedora)',
  o: '-y|--assumeyes Assume yes;-q|--quiet Quiet;--enablerepo= Enable repository;--disablerepo= Disable repository;--nogpgcheck Skip signature check',
  s: {
    install: 'Install',
    remove: 'Uninstall',
    update: 'Update',
    upgrade: 'Upgrade',
    search: 'Search',
    info: 'Details',
    makecache: 'Generate cache',
    repolist: 'List repositories',
    provides: 'Find the package that provides a file',
    history: 'Transaction history',
    reinstall: 'Reinstall',
    downgrade: 'Downgrade',
    groupinstall: 'Install a package group',
    'check-update': 'Check for updates',
    autoremove: 'Remove unused dependencies',
    localinstall: 'Install a local package',
    deplist: 'Dependency list',
    list: {
      d: 'List packages',
      v: 'installed Installed;available Available;updates Updates available',
    },
    clean: { d: 'Clear cache', v: 'all All;packages Packages;metadata Metadata' },
  },
}

const SCRIPTS = 'dev;build;start;test;lint;format;preview;serve;check'

const NPM: CommandSpec = {
  d: 'Node.js package manager',
  s: {
    install: {
      d: 'Install dependencies',
      o: '-g|--global Install globally;-D|--save-dev Dev dependency;-E|--save-exact Exact version;--omit=dev Skip dev dependencies;--legacy-peer-deps Ignore peer conflicts;--registry= Registry mirror',
    },
    i: {
      d: 'Install dependencies (short)',
      o: '-g|--global Install globally;-D|--save-dev Dev dependency;-E|--save-exact Exact version',
    },
    uninstall: { d: 'Uninstall', o: '-g|--global Global' },
    run: { d: 'Run a script', v: SCRIPTS },
    list: { d: 'Installed packages', o: '-g|--global Global;--depth= Depth' },
    audit: { d: 'Security audit', s: { fix: 'Fix automatically' } },
    cache: { d: 'Cache', s: { clean: 'Clear cache', verify: 'Verify cache' } },
    config: {
      d: 'Configuration',
      s: { get: 'Get', set: 'Set', list: 'List', delete: 'Remove' },
      v: 'registry Registry mirror',
    },
    init: { d: 'Initialize package.json', o: '-y|--yes Use defaults' },
    ci: 'Clean install from lockfile',
    update: 'Update dependencies',
    outdated: 'Check outdated dependencies',
    start: 'Run the start script',
    test: 'Run tests',
    exec: 'Run a package command',
    publish: 'Publish',
    login: 'Log in',
    view: 'View package info',
    version: 'Bump version',
    link: 'Link locally',
    pack: 'Pack',
    prune: 'Remove extraneous packages',
    dedupe: 'Dedupe dependencies',
    doctor: 'Check environment',
    whoami: 'Current user',
  },
}

const PNPM: CommandSpec = {
  d: 'Node.js package manager (pnpm)',
  s: {
    add: {
      d: 'Add dependency',
      o: '-D|--save-dev Dev dependency;-g|--global Global;-E|--save-exact Exact version',
    },
    install: {
      d: 'Install dependencies',
      o: '--frozen-lockfile Strictly follow lockfile;--prod Skip dev dependencies',
    },
    run: { d: 'Run a script', v: SCRIPTS },
    store: {
      d: 'Store',
      s: { prune: 'Remove unreferenced packages', path: 'Store path', status: 'Check' },
    },
    remove: 'Remove dependency',
    update: 'Update dependencies',
    dev: 'Run the dev script',
    build: 'Run the build script',
    exec: 'Run a command',
    dlx: 'Fetch and run temporarily',
    list: 'Installed packages',
    outdated: 'Check outdated dependencies',
    why: 'Show why a package is installed',
    init: 'Initialize',
  },
}

const YARN: CommandSpec = {
  d: 'Node.js package manager (yarn)',
  s: {
    add: { d: 'Add dependency', o: '-D|--dev Dev dependency;-E|--exact Exact version' },
    global: {
      d: 'Global packages',
      s: { add: 'Install globally', remove: 'Uninstall globally', list: 'List global packages' },
    },
    cache: { d: 'Cache', s: { clean: 'Clear cache', dir: 'Cache folder' } },
    install: 'Install dependencies',
    remove: 'Remove dependency',
    upgrade: 'Upgrade dependencies',
    run: 'Run a script',
    dev: 'Run the dev script',
    build: 'Run the build script',
    info: 'Package info',
    why: 'Show why a package is installed',
    init: 'Initialize',
    outdated: 'Check outdated dependencies',
  },
}

const PIP: CommandSpec = {
  d: 'Python package manager',
  s: {
    install: {
      d: 'Install',
      o: '-r|--requirement <file> Requirements file;-U|--upgrade Upgrade;--user Install to user folder;-e|--editable <path> Editable install;-i|--index-url <address> Index mirror;--no-cache-dir Disable cache;--break-system-packages Allow changes to system packages',
    },
    uninstall: {
      d: 'Uninstall',
      o: '-y|--yes No confirmation;-r|--requirement <file> Requirements file',
    },
    list: { d: 'Installed packages', o: '-o|--outdated Outdated packages;--format= Output format' },
    freeze: 'Export requirements',
    show: 'Package details',
    download: 'Download',
    search: 'Search',
    check: 'Check dependencies',
    config: 'Configuration',
    cache: { d: 'Cache', s: { purge: 'Clear', dir: 'Cache folder', info: 'Info' } },
  },
}
const CARGO: CommandSpec = {
  d: 'Rust build tool',
  o: '--release Release build;-p|--package <package> Target package;--all-targets All targets;--features <feature> Enable features;-j|--jobs <count> Parallel jobs',
  s: {
    build: 'Build',
    run: 'Run',
    test: 'Test',
    check: 'Check',
    clippy: 'Lint',
    fmt: 'Format',
    add: 'Add dependency',
    remove: 'Remove dependency',
    new: 'New project',
    init: 'Initialize',
    update: 'Update dependencies',
    clean: 'Clean up',
    doc: 'Build docs',
    install: 'Install a tool',
    publish: 'Publish',
    tree: 'Dependency tree',
    bench: 'Benchmark',
  },
}

const GO: CommandSpec = {
  d: 'Go toolchain',
  s: {
    mod: {
      d: 'Modules',
      s: {
        tidy: 'Tidy dependencies',
        init: 'Initialize module',
        download: 'Download dependencies',
        vendor: 'Copy to vendor',
        why: 'Explain why needed',
        graph: 'Dependency graph',
      },
    },
    build: {
      d: 'Build',
      o: '-o <file> Output file;-v Show package names;-race Race detection;-ldflags <arg> Linker flags',
    },
    test: {
      d: 'Test',
      o: '-v Verbose output;-run <pattern> Filter by name;-cover Coverage;-race Race detection;-count= Run count',
    },
    run: 'Compile and run',
    get: 'Get dependencies',
    install: 'Install',
    fmt: 'Format',
    vet: 'Static analysis',
    env: 'Environment variables',
    version: 'Version',
    clean: 'Clean up',
    generate: 'Generate code',
    work: 'Workspace',
  },
}

const TMUX: CommandSpec = {
  d: 'Terminal multiplexer',
  s: {
    new: { d: 'New session', o: '-s <name> Session name;-d Create detached' },
    attach: { d: 'Attach to session', o: '-t <session> Target session;-d Detach other clients' },
    a: { d: 'Attach to session (short)', o: '-t <session> Target session' },
    'kill-session': { d: 'Kill session', o: '-t <session> Target session' },
    'split-window': { d: 'Split pane', o: '-h Split side by side;-v Split top and bottom' },
    ls: 'List sessions',
    'kill-server': 'Kill all sessions',
    'new-window': 'New window',
    'rename-session': 'Rename session',
    'source-file': 'Reload config',
    detach: 'Detach',
  },
}

const SCREEN: CommandSpec = {
  d: 'Terminal multiplexer',
  o: '-S <name> New named session;-r Resume session;-ls|-list List sessions;-d Detach session;-x Shared attach;-dmS <name> New detached session;-X <command> Send command to session;-R Resume or create',
}

const PM2: CommandSpec = {
  d: 'Node process manager',
  o: '--name <name> Process name;-i|--instances <count> Number of instances;--watch Restart on file changes',
  s: {
    start: 'Start',
    stop: 'Stop',
    restart: 'Restart',
    reload: 'Zero-downtime reload',
    delete: 'Remove',
    list: 'List processes',
    ls: 'List processes',
    logs: 'Show logs',
    monit: 'Live monitor',
    save: 'Save process list',
    startup: 'Enable at boot',
    describe: 'Details',
    flush: 'Flush logs',
    resurrect: 'Restore saved processes',
  },
}

const SSH_OPTS =
  '-p <port> Port;-i <key> Private key file;-L <forward> Local port forwarding;-R <forward> Remote port forwarding;-D <port> SOCKS proxy;-J <jump> Jump host;-N Do not run a remote command;-f Run in background;-v Debug output;-o <option> Extra option;-A Forward auth agent;-X Forward X11;-T Do not allocate a terminal;-t Force terminal allocation;-C Compression'

const PRIV: CommandSpec = {
  d: 'Run as another user',
  c: true,
  o: '-u|--user <user> Target user;-i|--login Login shell;-s|--shell Run a shell;-E|--preserve-env Preserve environment;-k Clear cached credentials;-l|--list List privileges;-H Set HOME',
}

const TAR =
  '-czvf Create .tar.gz;-xzvf Extract .tar.gz;-cJvf Create .tar.xz;-xJvf Extract .tar.xz;-cjvf Create .tar.bz2;-xjvf Extract .tar.bz2;-xvf Extract (auto-detect);-tvf List contents;-cvf Create .tar;-C <dir> Extract into folder;-f <file> Archive file;--exclude= Exclude;--strip-components= Strip leading folders;-p Preserve permissions;-z gzip;-J xz;-j bzip2;-v Verbose output'
const SIGNAL_OPTS =
  '-s <signal> Signal to send;-l List signals;-9 Force kill (KILL);-15 Terminate gracefully (TERM);-HUP Reload (HUP)'
const SIGNAL_ARGS = { '-s': SIGNALS }
const RUNNER = (d: string, o?: string): CommandSpec => ({ d, c: true, o })
const FILE_OPS =
  '-r|-R|--recursive Recursive;-f|--force Force;-i|--interactive Prompt before overwrite;-v|--verbose Verbose output'

const IP: CommandSpec = {
  d: 'Network configuration',
  o: '-4 IPv4 only;-6 IPv6 only;-br|-brief Brief output;-c|-color Color output;-s|-stats Statistics;-j|-json JSON output',
  s: {
    addr: {
      d: 'Addresses',
      s: { show: 'Show URL', add: 'Add address', del: 'Delete address', flush: 'Flush addresses' },
    },
    a: 'Show addresses (short)',
    link: {
      d: 'Network interfaces',
      s: {
        show: 'Show interfaces',
        set: 'Change interface (up/down/mtu)',
        add: 'Add virtual interface',
        delete: 'Delete interface',
      },
    },
    route: {
      d: 'Routes',
      s: {
        show: 'Show routes',
        add: 'Add route',
        del: 'Delete route',
        get: 'Get route to an address',
        flush: 'Flush routes',
      },
    },
    r: 'Show routes (short)',
    neigh: { d: 'ARP/neighbor table', s: { show: 'Show', flush: 'Clear' } },
    rule: 'Policy routing rules',
    netns: {
      d: 'Network namespaces',
      s: { list: 'List', add: 'Add', delete: 'Remove', exec: 'Run in namespace' },
    },
  },
}

const UFW: CommandSpec = {
  d: 'Firewall (Ubuntu)',
  s: {
    status: { d: 'Show status', v: 'verbose Detailed;numbered With rule numbers' },
    allow: { d: 'Allow', v: '22/tcp SSH;80/tcp HTTP;443/tcp HTTPS;OpenSSH;from' },
    deny: { d: 'Deny', v: 'from' },
    delete: { d: 'Delete rule', v: 'allow;deny' },
    default: { d: 'Default policy', v: 'allow;deny;reject' },
    enable: 'Enable',
    disable: 'Disable',
    reload: 'Reload',
    reset: 'Reset all rules',
    limit: 'Allow with rate limit',
    logging: 'Log level',
    app: 'Apply config',
  },
}

const FIREWALL_CMD: CommandSpec = {
  d: 'Firewall (firewalld)',
  o: '--state Running state;--reload Reload;--permanent Make permanent;--zone= Zone;--list-all List current zone;--list-ports Allowed ports;--list-services Allowed services;--add-port= Allow port, e.g. 8080/tcp;--remove-port= Remove port;--add-service= Allow service;--remove-service= Remove service;--get-active-zones Active zones;--add-rich-rule= Add rich rule;--add-masquerade Enable NAT',
}

const IPTABLES: CommandSpec = {
  d: 'Packet filter rules',
  o: '-L|--list List rules;-n|--numeric Do not resolve names;-v|--verbose Verbose;--line-numbers Show line numbers;-t|--table <table> Table to use;-A|--append <chain> Append rule;-I|--insert <chain> Insert rule;-D|--delete <chain> Delete rule;-F|--flush Flush rules;-P|--policy <chain> Default policy;-p|--protocol <protocol> Protocol;--dport <port> Destination port;--sport <port> Source port;-s|--source <address> Source address;-d|--destination <address> Destination address;-i <interface> Input interface;-o <interface> Output interface;-j|--jump <action> Target action;-m <module> Match module;-S List as commands',
  a: {
    '-t': 'filter;nat;mangle;raw',
    '-A': 'INPUT;OUTPUT;FORWARD;PREROUTING;POSTROUTING',
    '-I': 'INPUT;OUTPUT;FORWARD;PREROUTING;POSTROUTING',
    '-D': 'INPUT;OUTPUT;FORWARD;PREROUTING;POSTROUTING',
    '-P': 'INPUT;OUTPUT;FORWARD',
    '-p': 'tcp;udp;icmp;all',
    '-j': 'ACCEPT Allow;DROP Discard;REJECT Reject;LOG Log;MASQUERADE Masquerade address;DNAT Destination NAT;SNAT Source NAT;RETURN Return',
    '-m': 'state;conntrack;multiport;limit;comment',
  },
}

const OPENSSL: CommandSpec = {
  d: 'Certificate and crypto toolkit',
  s: {
    x509: {
      d: 'Certificate tool',
      o: '-in <file> Input certificate;-noout No encoded output;-text Text details;-dates Validity dates;-subject Subject;-issuer Issuer;-fingerprint Fingerprint',
    },
    req: {
      d: 'Certificate request',
      o: '-new New request;-x509 Self-signed certificate;-newkey <algorithm> Generate new key;-nodes Do not encrypt private key;-keyout <file> Private key output;-out <file> Output;-days <days> Days valid;-subj <subject> Subject',
    },
    s_client: {
      d: 'TLS client test',
      o: '-connect <address> host:port;-servername <domain> SNI;-showcerts Show certificate chain',
    },
    genrsa: 'Generate RSA private key',
    genpkey: 'Generate private key',
    rsa: 'RSA key tool',
    rand: { d: 'Random bytes', o: '-hex Hexadecimal;-base64 Base64' },
    dgst: 'Message digest',
    enc: 'Symmetric encryption',
    passwd: 'Generate password hash',
    version: 'Version',
    pkcs12: 'PKCS#12 tool',
    verify: 'Verify certificate chain',
  },
}

/** Every command the completion knows about, keyed by name. */
export const SPECS: Record<string, CommandSpec | string> = {
  git: GIT,
  docker: DOCKER,
  'docker-compose': COMPOSE,
  podman: { ...DOCKER, d: 'Container management (podman)' },
  kubectl: KUBECTL,
  k: KUBECTL,
  helm: HELM,
  systemctl: SYSTEMCTL,
  journalctl: JOURNALCTL,
  service: { d: 'Service management (SysV)', v: UNITS, o: '--status-all Status of all services' },
  apt: APT,
  'apt-get': APT_GET,
  yum: YUM,
  dnf: { ...YUM, d: 'Package manager (dnf)' },
  apk: {
    d: 'Package manager (Alpine)',
    s: {
      add: 'Install',
      del: 'Uninstall',
      update: 'Update index',
      upgrade: 'Upgrade',
      search: 'Search',
      info: 'Details',
      list: 'List',
    },
    o: '--no-cache Do not keep cache',
  },
  pacman: {
    d: 'Package manager (Arch)',
    o: '-S Install;-Syu Sync and upgrade;-R Remove;-Rs Remove with dependencies;-Ss Search;-Q Installed;-Qi Details;--noconfirm No confirmation',
  },
  snap: {
    d: 'Snap packages',
    s: {
      install: 'Install',
      remove: 'Uninstall',
      list: 'Installed',
      find: 'Search',
      refresh: 'Update',
      info: 'Details',
      services: 'Service',
    },
  },
  npm: NPM,
  pnpm: PNPM,
  yarn: YARN,
  npx: RUNNER(
    'Run a command from an npm package',
    '-y|--yes Install without prompting;-p|--package <package> Target package',
  ),
  pip: PIP,
  pip3: PIP,
  cargo: CARGO,
  go: GO,
  tmux: TMUX,
  screen: SCREEN,
  pm2: PM2,
  sudo: PRIV,
  doas: { ...PRIV, d: 'Run as another user (doas)' },
  su: {
    d: 'Switch user',
    v: 'root',
    o: '-|-l|--login Login shell;-c|--command <command> Run command;-s|--shell <shell> Shell to use',
  },
  watch: RUNNER(
    'Run a command periodically',
    '-n|--interval <seconds> Interval;-d|--differences Highlight changes;-t|--no-title Hide header;-c|--color Keep colors',
  ),
  xargs: RUNNER(
    'Build arguments from input',
    '-n|--max-args <count> Arguments per command;-I <placeholder> Replace string;-P|--max-procs <count> Parallel processes;-0|--null NUL-separated input;-r|--no-run-if-empty Skip if input is empty;-t Print commands',
  ),
  nohup: RUNNER('Run immune to hangups'),
  time: RUNNER('Time a command'),
  env: RUNNER(
    'Run with a modified environment',
    '-i|--ignore-environment Start with an empty environment;-u|--unset <var> Unset variable',
  ),
  nice: RUNNER('Run with a given priority', '-n|--adjustment <value> Priority adjustment'),
  timeout: RUNNER(
    'Run with a time limit',
    '-s|--signal <signal> Signal on timeout;-k|--kill-after <duration> Then force kill after',
  ),
  strace: RUNNER(
    'Trace system calls',
    '-p <PID> Attach to process;-f Follow child processes;-e <expression> Filter;-o <file> Output file;-c Summary counts',
  ),
  ssh: { d: 'Remote login', o: SSH_OPTS },
  scp: path(
    'Remote copy',
    `${SSH_OPTS.replace('-p <port> Port', '-P <port> Port')};-r Recursive;-p Preserve times and modes;-l <rate> Bandwidth limit Kbit/s`,
  ),
  rsync: path(
    'Sync files',
    '-a|--archive Archive mode;-v|--verbose Verbose;-z|--compress Compress during transfer;-h|--human-readable Human-readable units;-P Show progress and keep partial files;--progress Show progress;--delete Delete extra files at destination;-n|--dry-run Dry run;-e <command> Remote shell, e.g. "ssh -p 2222";--exclude= Exclude;--include= Include;--bwlimit= Bandwidth limit KB/s;-u|--update Skip newer files;--partial Keep partially transferred files',
  ),
  'ssh-keygen': {
    d: 'Generate SSH keys',
    o: '-t <type> Key type;-b <bits> Key length in bits;-C <comment> Comment;-f <file> Output file;-R <host> Remove from known_hosts;-l Show fingerprint;-p Change passphrase;-N <passphrase> New passphrase',
    a: { '-t': 'ed25519 Recommended;rsa RSA;ecdsa ECDSA' },
  },
  'ssh-copy-id': {
    d: 'Copy public key to server',
    o: '-i <pubkey> Public key file;-p <port> Port',
  },
  tar: path('Archive and compress', TAR),
  zip: path(
    'Compress to zip',
    '-r Recursive;-q Quiet;-9 Best compression;-e Encrypt;-x <pattern> Exclude',
  ),
  unzip: path(
    'Extract zip',
    '-d <dir> Extract into folder;-l List contents;-o Overwrite without prompting;-q Quiet;-O <encoding> File name encoding',
  ),
  gzip: path(
    'gzip compression',
    '-d Decompress;-k Keep original file;-r Recursive;-9 Best compression;-l Show info',
  ),
  gunzip: path('gzip decompression', '-k Keep original file'),
  xz: path(
    'xz compression',
    '-d Decompress;-k Keep original file;-T <threads> Thread count;-9 Best compression',
  ),
  '7z': {
    d: '7-Zip',
    s: {
      a: 'Compress',
      x: 'Extract (keep paths)',
      e: 'Extract into current folder',
      l: 'List contents',
      t: 'Test',
    },
    p: true,
  },
  kill: { d: 'Send a signal to processes', o: SIGNAL_OPTS, a: SIGNAL_ARGS },
  pkill: {
    d: 'Signal processes by name',
    o: `${SIGNAL_OPTS};-f Match full command line;-u <user> By user;-x Exact match`,
    a: SIGNAL_ARGS,
  },
  killall: {
    d: 'Kill processes by name',
    o: `${SIGNAL_OPTS};-u <user> By user;-i Ask for confirmation;-w Wait for processes to end`,
    a: SIGNAL_ARGS,
  },
  pgrep: {
    d: 'Find processes by name',
    o: '-f Match full command line;-l Show process name;-a Show full command line;-u <user> By user;-x Exact match',
  },
  ps: {
    d: 'Process list',
    v: 'aux All processes (BSD style);-ef All processes (standard format);axjf Process tree',
    o: '-e All processes;-f Full format;-u <user> By user;-p <PID> By PID;-o <field> Custom columns;--sort= Sort key, e.g. -%mem;--forest Process tree',
  },
  top: {
    d: 'Live process viewer',
    o: '-d <seconds> Refresh interval;-p <PID> Watch given process;-u <user> By user;-b Batch mode;-n <times> Number of refreshes;-o <field> Sort field',
  },
  htop: {
    d: 'Live process viewer (interactive)',
    o: '-d <tenths> Refresh interval;-u <user> By user;-p <PID> Watch given process;-t|--tree Tree view',
  },
  ls: path(
    'List folder contents',
    '-l Long listing;-a|--all Include hidden files;-A Hidden files, excluding . and ..;-h|--human-readable Human-readable sizes;-t Sort by time;-S Sort by size;-r|--reverse Newest first;-R|--recursive Recursive;-d List folders themselves;-1 One per line;-i Show inode;--color=auto Color;-lah Long + hidden + human-readable;-ltr Sort by time, oldest first',
  ),
  ll: path('Long listing'),
  cd: path('Change folder'),
  pwd: 'Current folder',
  cat: path(
    'Print file contents',
    '-n|--number Number lines;-A Show non-printing characters;-s Squeeze blank lines',
  ),
  less: path(
    'Page through text',
    '-N Show line numbers;-S Do not wrap lines;-R Keep colors;+F Keep following',
  ),
  more: path('Page through text'),
  head: path(
    'Show the first lines',
    '-n|--lines <lines> Number of lines;-c|--bytes <bytes> Number of bytes',
  ),
  tail: path(
    'Show the last lines',
    '-n|--lines <lines> Number of lines;-f Keep following;-F Follow across log rotation;-c|--bytes <bytes> Number of bytes;--pid= Exit when the process ends',
  ),
  grep: path(
    'Search text',
    '-i|--ignore-case Ignore case;-r|--recursive Recursive;-R Recursive, follow symlinks;-n|--line-number Show line numbers;-v|--invert-match Invert match;-w|--word-regexp Whole words;-l|--files-with-matches File names only;-c|--count Count matches;-E|--extended-regexp Extended regex;-F|--fixed-strings Fixed strings;-o|--only-matching Only the matching part;-A <lines> N lines after;-B <lines> N lines before;-C <lines> N lines around;--include= Include files;--exclude= Exclude files;--exclude-dir= Exclude folders;--color=auto Highlight',
  ),
  find: path(
    'Find files',
    '-name <pattern> By name;-iname <pattern> By name (case-insensitive);-type <type> File type;-size <size> Size, e.g. +100M;-mtime <days> Modification time;-mmin <minutes> Modification time (minutes);-user <user> Owner;-perm <mode> Permissions;-maxdepth <levels> Max depth;-mindepth <levels> Min depth;-exec <command> Run command;-delete Delete;-print0 NUL-separated output;-empty Empty files;-newer <file> Newer than file;-path <pattern> By path;-prune Skip directory;-not Negate',
  ),
  sed: path(
    'Stream editor',
    '-i Edit in place;-n Quiet;-e <script> Script;-E|-r Extended regex;-f <file> Script file',
  ),
  awk: path(
    'Text processing',
    '-F <delimiter> Field separator;-v <var> Define variable;-f <file> Script file',
  ),
  sort: path(
    'Sort lines',
    '-n Numeric sort;-h Human-readable numbers;-r Reverse order;-u Unique only;-k <field> By field;-t <delimiter> Field separator;-V Version sort',
  ),
  uniq: path(
    'Remove duplicate lines',
    '-c Count;-d Duplicates only;-u Unique lines only;-i Ignore case',
  ),
  wc: path('Count lines, words and bytes', '-l Lines;-w Words;-c Bytes;-m Characters'),
  cut: path('Cut columns', '-d <delimiter> Delimiter;-f <field> Fields;-c <range> Character range'),
  tr: { d: 'Translate characters', o: '-d Delete characters;-s Squeeze repeats;-c Complement set' },
  tee: path('Also write to file', '-a|--append Append'),
  diff: path(
    'Compare files',
    '-u Unified format;-r Recursive;-q Report only whether files differ;-w Ignore whitespace;-y Side by side',
  ),
  cp: path(
    'Copy',
    `${FILE_OPS};-a|--archive Archive (keep attributes);-p Keep permissions and times;-u|--update Copy only newer files;-n No overwrite`,
  ),
  mv: path(
    'Move or rename',
    '-f|--force Force;-i|--interactive Prompt before overwrite;-n No overwrite;-v|--verbose Verbose output;-u|--update Copy only newer files',
  ),
  rm: path('Remove', `${FILE_OPS};-d Remove empty directories;-rf Force recursive delete`),
  mkdir: path(
    'Create directory',
    '-p|--parents Create parent directories;-m|--mode <mode> Permissions;-v Verbose output',
  ),
  rmdir: path('Remove empty directory', '-p Also remove empty parents'),
  touch: path(
    'Create file or update timestamps',
    '-a Access time only;-m Modification time only;-d <time> Use given time',
  ),
  ln: path(
    'Create link',
    '-s|--symbolic Symbolic link;-f|--force Overwrite existing;-n Do not follow target link;-v Verbose output',
  ),
  chmod: path(
    'Change permissions',
    '-R|--recursive Recursive;-v Verbose output;--reference= Reference file',
  ),
  chown: path(
    'Change owner',
    '-R|--recursive Recursive;-h Change the link itself;--reference= Reference file',
  ),
  chgrp: path('Change group', '-R|--recursive Recursive'),
  chattr: path(
    'Change file attributes',
    '-R Recursive;+i Make immutable;-i Remove immutable flag;+a Append only',
  ),
  lsattr: path('Show file attributes'),
  stat: path('File details', '-c|--format <format> Output format;-f File system info'),
  file: path('Detect file type'),
  realpath: path('Absolute path'),
  tree: path(
    'Directory tree',
    '-L <levels> Max depth;-a Include hidden files;-d Directories only;-h Human-readable sizes;-I <pattern> Exclude',
  ),
  du: path(
    'Directory usage',
    '-h|--human-readable Human-readable units;-s|--summarize Show total only;-a Include files;-d|--max-depth <levels> Max depth;-c Grand total;--exclude= Exclude;-sh Total (human-readable)',
  ),
  df: path(
    'Disk space',
    '-h|--human-readable Human-readable units;-T|--print-type File system type;-i|--inodes inode usage;-x <type> Exclude type',
  ),
  free: {
    d: 'Memory usage',
    o: '-h|--human Human-readable units;-m In MB;-g In GB;-s <seconds> Keep refreshing;-t Show total;-w Show buffers and cache separately',
  },
  lsblk: {
    d: 'Block devices',
    o: '-f File systems;-a All;-o <field> Custom columns;-p Full paths;-d Hide partitions',
  },
  blkid: 'Block device attributes',
  mount: path(
    'Mount',
    '-t <type> File system type;-o <option> Mount options;-a Mount all in fstab;-l List mounts',
  ),
  umount: path('Unmount a file system', '-l Lazy unmount;-f Force'),
  fdisk: { d: 'Partition disks', o: '-l List partitions' },
  uptime: { d: 'Uptime and load', o: '-p Pretty format;-s Up since' },
  uname: {
    d: 'System info',
    o: '-a All;-r Kernel release;-m Machine architecture;-n Hostname;-o Operating system',
  },
  hostnamectl: { d: 'Hostname', s: { status: 'Show', 'set-hostname': 'Set hostname' } },
  timedatectl: {
    d: 'Time and time zone',
    s: {
      status: 'Show',
      'set-timezone': {
        d: 'Set time zone',
        v: 'Asia/Shanghai;UTC;Asia/Hong_Kong;Asia/Tokyo;America/Los_Angeles;Europe/London',
      },
      'list-timezones': 'List time zones',
      'set-ntp': { d: 'Automatic time sync', v: 'true;false' },
      'set-time': 'Set time',
    },
  },
  date: {
    d: 'Date and time',
    o: '-u Universal time;-d|--date <time> Show given time;-s|--set <time> Set time;-R RFC 5322 format;-I ISO 8601 format',
  },
  dmesg: {
    d: 'Kernel log',
    o: '-T Human-readable timestamps;-w|--follow Follow new messages;-H Human-readable output;-l <level> Log level;-c Clear after reading',
  },
  lsof: path(
    'Open files',
    '-i <address> Network connections, e.g. :80;-p <PID> By process;-u <user> By user;-n No hostname lookup;-P No port name lookup',
  ),
  ss: {
    d: 'Socket statistics',
    v: '-tulnp Listening ports and processes;-tanp All TCP connections',
    o: '-t|--tcp TCP;-u|--udp UDP;-l|--listening Listening;-n|--numeric Numeric, no lookups;-p|--processes Show processes;-a|--all All;-s|--summary Summary;-4 IPv4;-6 IPv6;-e Extended info;-tulnp Listening ports and processes',
  },
  netstat: {
    d: 'Network statistics',
    o: '-t TCP;-u UDP;-l Listening;-n Numeric, no lookups;-p Show processes;-a All;-r Routing table;-i Network interfaces;-s Statistics;-tulnp Listening ports and processes',
  },
  ip: IP,
  ifconfig: { d: 'Interface config (legacy)', o: '-a All interfaces' },
  ping: {
    d: 'Connectivity test',
    o: '-c <times> Count;-i <seconds> Interval;-W <seconds> Timeout;-s <bytes> Packet size;-4 IPv4;-6 IPv6;-q Summary only',
  },
  traceroute: {
    d: 'Trace route',
    o: '-n No hostname lookup;-I Use ICMP;-T Use TCP;-p <port> Port;-m <hops> Max hops',
  },
  mtr: {
    d: 'Trace route (continuous)',
    o: '-r|--report Report mode;-c <times> Count;-n No hostname lookup;-T Use TCP;-w Wide report',
  },
  dig: {
    d: 'DNS lookup',
    v: 'A;AAAA;CNAME;MX;TXT;NS;SOA;PTR;ANY',
    o: '+short Short output;+trace Trace resolution;-x <address> Reverse lookup;+noall Hide other sections;+answer Answer section only',
  },
  nslookup: 'DNS lookup',
  host: 'DNS lookup',
  nc: {
    d: 'Network tool (netcat)',
    o: '-z Scan only, send no data;-v Verbose;-l Listen;-p <port> Local port;-u UDP;-w <seconds> Timeout;-k Keep listening',
  },
  telnet: 'Remote connection test',
  curl: {
    d: 'Send HTTP requests',
    o: '-X|--request <method> Request method;-H|--header <header> Request header;-d|--data <data> Request body;--data-raw <data> Raw request body;-F|--form <field> Form field;-o|--output <file> Save to file;-O|--remote-name Save with remote file name;-L|--location Follow redirects;-I|--head Fetch headers only;-i|--include Include response headers;-s|--silent Silent;-S|--show-error Show errors;-f|--fail Exit with error code on failure;-k|--insecure Skip certificate check;-u|--user <account> Auth as user:password;-x|--proxy <proxy> Use proxy;-v|--verbose Verbose;-w|--write-out <format> Output format;--connect-timeout <seconds> Connect timeout;-m|--max-time <seconds> Total timeout;-C <offset> Resume transfer;-A|--user-agent <UA> UA;-b|--cookie <Cookie> Cookie;--compressed Request compressed response;-4 IPv4;-6 IPv6;-fsSL Silent, follow redirects (common in install scripts)',
    a: {
      '-X': 'GET;POST;PUT;PATCH;DELETE;HEAD;OPTIONS',
      '-H': '"Content-Type: application/json";"Authorization: Bearer ";"Accept: application/json"',
    },
  },
  wget: {
    d: 'Download files',
    o: '-O <file> Save as;-P <dir> Output directory;-c|--continue Resume download;-q|--quiet Quiet;-b|--background Run in background;-r|--recursive Recursive;--no-check-certificate Skip certificate check;-t|--tries <times> Retry count;-T|--timeout <seconds> Timeout;--limit-rate= Rate limit;-i <file> Read URLs from file',
  },
  crontab: { d: 'Scheduled jobs', o: '-e Edit;-l List;-r Remove all;-u <user> For user' },
  useradd: {
    d: 'Add user',
    o: '-m Create home directory;-s <shell> Login shell;-G <group> Supplementary groups;-g <group> Primary group;-d <dir> Home directory;-u <UID> Set UID;-r System account;-c <message> Comment',
    a: { '-s': '/bin/bash;/bin/sh;/usr/sbin/nologin;/bin/zsh' },
  },
  usermod: {
    d: 'Modify user',
    o: '-aG <group> Add to supplementary groups;-s <shell> Login shell;-L Lock;-U Unlock;-d <dir> Home directory;-l <newname> Rename',
    a: { '-aG': 'sudo;wheel;docker;adm', '-s': '/bin/bash;/bin/sh;/usr/sbin/nologin;/bin/zsh' },
  },
  userdel: { d: 'Delete user', o: '-r Also remove home directory;-f Force' },
  groupadd: 'Add group',
  passwd: {
    d: 'Change password',
    o: '-l Lock;-u Unlock;-d Delete password;-e Force change at next login;-S Status',
  },
  id: 'User and group IDs',
  whoami: 'Current user',
  who: 'Logged-in users',
  w: 'Logged-in users and activity',
  last: { d: 'Login history', o: '-n <count> Last N entries;-x Include shutdowns and reboots' },
  history: { d: 'Command history', o: '-c Clear;-d <index> Delete one entry;-w Write to file' },
  alias: 'Command aliases',
  export: 'Export environment variables',
  source: path('Run script in current shell'),
  echo: { d: 'Print text', o: '-n No trailing newline;-e Interpret escapes' },
  printf: 'Formatted output',
  which: 'Locate a command',
  whereis: 'Locate binary, source and manual',
  type: 'Command type',
  man: 'Show manual',
  clear: 'Clear screen',
  exit: 'Exit',
  reboot: 'Restart',
  shutdown: {
    d: 'Power off',
    v: 'now Immediately;+10 In 10 minutes',
    o: '-h Power off;-r Reboot;-c Cancel',
  },
  nginx: {
    d: 'Nginx',
    o: '-t Test config;-T Test and dump config;-s <signal> Send signal;-c <file> Config file;-v Version;-V Version and build options',
    a: {
      '-s': 'reload Reload config;stop Stop immediately;quit Graceful shutdown;reopen Reopen log files',
    },
  },
  mysql: {
    d: 'MySQL client',
    o: '-u|--user <user> User;-p|--password Prompt for password;-h|--host <host> Host;-P|--port <port> Port;-D|--database <db> Database;-e|--execute <SQL> Execute statement;--default-character-set= Character set',
  },
  mysqldump: {
    d: 'MySQL dump',
    o: '-u|--user <user> User;-p|--password Prompt for password;-h|--host <host> Host;--all-databases All databases;--single-transaction Consistent snapshot;--routines Include stored procedures;--no-data Schema only;-r|--result-file <file> Output file',
  },
  psql: {
    d: 'PostgreSQL client',
    o: '-U|--username <user> User;-h|--host <host> Host;-p|--port <port> Port;-d|--dbname <db> Database;-c|--command <SQL> Execute statement;-f|--file <file> Run script file;-l|--list List databases',
  },
  'redis-cli': {
    d: 'Redis client',
    o: '-h <host> Host;-p <port> Port;-a <password> Password;-n <db> Database number;--scan Scan keys;--pattern <pattern> Key pattern;--bigkeys Find big keys;--latency Latency test;--stat Live stats;-c Cluster mode',
    v: 'ping;info;monitor;dbsize;flushdb;keys;get;set;del;ttl;config',
  },
  python3: path(
    'Python',
    '-m <module> Run module;-c <code> Run code;-V|--version Version;-u Unbuffered output;-i Interactive after running',
  ),
  python: path('Python', '-m <module> Run module;-c <code> Run code;-V|--version Version'),
  node: path(
    'Node.js',
    '-e|--eval <code> Evaluate code;-v|--version Version;--inspect Debug;-r|--require <module> Preload module;--max-old-space-size= Memory limit',
  ),
  bash: path(
    'Bash',
    '-c <command> Run command;-x Trace execution;-n Syntax check only;-l Login shell',
  ),
  sh: path('Shell', '-c <command> Run command;-x Trace execution'),
  vim: path('Vim editor', '-R Read-only;-O Open in vertical splits;-d Diff mode'),
  vi: path('Vi editor'),
  nano: path('Nano editor', '-l Show line numbers;-w No line wrapping;-v Read-only'),
  'iptables-save': 'Export firewall rules',
  'iptables-restore': path('Import firewall rules'),
  ufw: UFW,
  'firewall-cmd': FIREWALL_CMD,
  iptables: IPTABLES,
  ip6tables: { ...IPTABLES, d: 'Packet filter rules (IPv6)' },
  openssl: OPENSSL,
  certbot: {
    d: 'Request HTTPS certificates',
    s: {
      certonly: 'Obtain certificate only',
      renew: { d: 'Renew certificates', o: '--dry-run Dry run' },
      certificates: 'List certificates',
      delete: 'Delete certificate',
      revoke: 'Revoke certificate',
    },
    o: '--nginx Use Nginx plugin;--standalone Standalone mode;--webroot Webroot mode;-d <domain> Domain;-w <dir> Webroot directory;--email <email> Email address;--agree-tos Agree to terms of service;-n|--non-interactive Non-interactive',
  },
}
