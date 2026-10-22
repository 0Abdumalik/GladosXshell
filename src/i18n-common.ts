import { messages } from './i18n'

/**
 * Words many screens share (buttons, column headings). A module that needs other text keeps
 * its own `messages()`; this list only grows for words that really are the same everywhere.
 */
export const common = messages({
  cancel: { zh: '取消', en: 'Cancel', ug: 'ۋاز كەچ' },
  ok: { zh: '确定', en: 'OK', ug: 'جەزملە' },
  save: { zh: '保存', en: 'Save', ug: 'ساقلا' },
  delete: { zh: '删除', en: 'Delete', ug: 'ئۆچۈر' },
  remove: { zh: '移除', en: 'Remove', ug: 'چىقىرىۋەت' },
  close: { zh: '关闭', en: 'Close', ug: 'ياپ' },
  open: { zh: '打开', en: 'Open', ug: 'ئاچ' },
  rename: { zh: '重命名', en: 'Rename', ug: 'ئات ئۆزگەرت' },
  refresh: { zh: '刷新', en: 'Refresh', ug: 'يېڭىلا' },
  reload: { zh: '重新加载', en: 'Reload', ug: 'قايتا يۈكلە' },
  copy: { zh: '复制', en: 'Copy', ug: 'كۆچۈر' },
  paste: { zh: '粘贴', en: 'Paste', ug: 'چاپلا' },
  selectAll: { zh: '全选', en: 'Select all', ug: 'ھەممىنى تاللا' },
  create: { zh: '创建', en: 'Create', ug: 'قۇر' },
  import: { zh: '导入', en: 'Import', ug: 'ئەكىر' },
  export: { zh: '导出', en: 'Export', ug: 'چىقار' },
  upload: { zh: '上传', en: 'Upload', ug: 'يۈكلە' },
  download: { zh: '下载', en: 'Download', ug: 'چۈشۈر' },
  run: { zh: '运行', en: 'Run', ug: 'ئىجرا قىل' },
  stop: { zh: '停止', en: 'Stop', ug: 'توختات' },
  expand: { zh: '展开', en: 'Expand', ug: 'ياي' },
  collapse: { zh: '收起', en: 'Collapse', ug: 'يىغ' },
  reconnect: { zh: '重新连接', en: 'Reconnect', ug: 'قايتا ئۇلا' },
  cancelled: { zh: '已取消', en: 'Cancelled', ug: 'ۋاز كەچتى' },
  name: { zh: '名称', en: 'Name', ug: 'ئاتى' },
  type: { zh: '类型', en: 'Type', ug: 'تىپى' },
  host: { zh: '主机', en: 'Host', ug: 'ئاساسىي ماشىنا' },
  port: { zh: '端口', en: 'Port', ug: 'ئېغىز' },
  address: { zh: '地址', en: 'Address', ug: 'ئادرېس' },
  password: { zh: '密码', en: 'Password', ug: 'ئىم' },
  note: { zh: '备注', en: 'Note', ug: 'ئىزاھ' },
  permissions: { zh: '权限', en: 'Permissions', ug: 'ھوقۇق' },
  terminal: { zh: '终端', en: 'Terminal', ug: 'تېرمىنال' },
  session: { zh: '会话', en: 'Session', ug: 'ئەڭگىمە' },
  ungrouped: { zh: '未分组', en: 'Ungrouped', ug: 'گۇرۇپپىسىز' },
  newConnection: { zh: '新建连接', en: 'New connection', ug: 'يېڭى ئۇلىنىش' },
})
