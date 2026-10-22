import type { Layout } from '../../layout'
import type { Report } from '../../status/widgets'
import type { BuiltinPlugin } from '../api'
import { broadcastPlugin } from './broadcast'
import { containersPlugin } from './containers'
import { core } from './core'
import { completionPlugin, editorPlugin, suggestPlugin } from './features'
import { filesFollowPlugin } from './files-follow'
import { forwardsPlugin } from './forwards'
import { guidePlugin } from './guide'
import { keysPlugin } from './keys'
import { logHighlightPlugin } from './log-highlight'
import { macrosPlugin } from './macros'
import { commandsPlugin, connectionsPlugin, filesPlugin, statusPlugin } from './panels'
import { recordingPlugin } from './recording'
import { themesPlugin } from './themes'
import { triggersPlugin } from './triggers'

export function builtinPlugins(layout: Layout, report: Report): BuiltinPlugin[] {
  return [
    core,
    themesPlugin,
    completionPlugin,
    suggestPlugin,
    editorPlugin,
    statusPlugin(layout, report),
    filesPlugin,
    filesFollowPlugin,
    commandsPlugin,
    connectionsPlugin,
    forwardsPlugin,
    containersPlugin,
    broadcastPlugin,
    keysPlugin,
    triggersPlugin,
    macrosPlugin,
    recordingPlugin,
    logHighlightPlugin,
    guidePlugin,
  ]
}
