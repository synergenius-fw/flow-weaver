---
name: Visual Reference
description: Available colors, icons, and tags for visual node customization
keywords: [color, icon, tag, visual, theme, customization, material, symbols]
---

# Visual Reference

Reference for all available visual customization options in Flow Weaver workflow annotations.

## Colors

Nine predefined colors for node borders and icons. Set via `[color: "name"]` on `@node` annotations.

| Color | Suggested Use |
|-------|---------------|
| `blue` | Data processing, general purpose |
| `purple` | Deployment, versioning |
| `cyan` | Network, cloud operations |
| `orange` | Infrastructure, builds |
| `pink` | Alerts, highlights |
| `green` | Success, completion, health |
| `red` | Danger, errors, destructive actions |
| `yellow` | Warnings, caution |
| `teal` | Validation, preflight checks |

### Usage

On node type definitions:
```
@flowWeaver nodeType
@color blue
```

On instance declarations:
```
@node myDb fetchData [color: "blue"] [icon: "database"]
```

## Icons

All icons use [Material Symbols](https://fonts.google.com/icons) (Outlined, weight 500). Names are **camelCase**.

### AI & Machine Learning

| Icon | Name |
|------|------|
| Brain/AI | `psychology` |
| Robot | `smartToy` |
| Magic sparkle | `autoAwesome` |
| Model training | `modelTraining` |
| Science flask | `science` |
| Biotech | `biotech` |

### Data & Storage

| Icon | Name |
|------|------|
| Database | `database` |
| JSON/data object | `dataObject` |
| Table | `tableChart` |
| Token | `token` |
| Storage | `storage` |
| Chat/memory | `memory` |
| Inventory | `inventory` |
| Receipt/log | `receipt` |
| Text snippet | `textSnippet` |

### Network & Cloud

| Icon | Name |
|------|------|
| API | `api` |
| Webhook | `webhook` |
| Cloud sync | `cloudSync` |
| Cloud upload | `cloudUpload` |
| Cloud download | `cloudDownload` |
| Cloud done | `cloudDone` |
| DNS | `dns` |
| Router | `router` |
| HTTP | `http` |
| Link | `link` |
| Backup (cloud) | `backup` |

### Security & Auth

| Icon | Name |
|------|------|
| Key | `key` |
| Shield | `shield` |
| VPN key | `vpnKey` |
| Verified | `verified` |
| Security | `security` |
| Policy | `policy` |
| Admin settings | `adminPanelSettings` |
| Lock | `lock` |
| Lock open | `lockOpen` |

### Flow & Logic

| Icon | Name |
|------|------|
| Flow graph | `flow` |
| Branch/split | `altRoute` |
| Call split | `callSplit` |
| Call merge | `callMerge` |
| Rule/condition | `rule` |
| Filter | `filterAlt` |
| Loop/repeat | `repeat` |
| Sort | `sort` |

### People & Identity

| Icon | Name |
|------|------|
| Person | `person` |
| People/group | `people` |
| Group | `group` |
| Person add | `personAdd` |
| Person blocked | `personOff` |

### Actions & Operations

| Icon | Name |
|------|------|
| Lightning bolt | `bolt` |
| Build/wrench | `build` |
| Rocket launch | `rocketLaunch` |
| Send | `send` |
| Sync | `sync` |
| Refresh | `refresh` |
| Play | `playArrow` |
| Pause | `pause` |
| Stop | `stop` |
| Restart | `restart` |
| Block/deny | `block` |
| Copy | `contentCopy` |
| Delete forever | `deleteForever` |
| Code | `code` |

### Notifications & Communication

| Icon | Name |
|------|------|
| Notification bell | `notifications` |
| Notifications active | `notificationsActive` |
| Email | `email` |
| Campaign | `campaign` |

### Status & Monitoring

| Icon | Name |
|------|------|
| Check circle | `checkCircle` |
| Error | `error` |
| Warning | `warning` |
| Info | `info` |
| Help | `help` |
| Monitoring/chart | `monitoring` |
| Health & safety | `healthAndSafety` |
| Task | `task` |
| Pending actions | `pendingActions` |
| Spellcheck | `spellcheck` |
| Assessment | `assessment` |
| Summarize | `summarize` |

### Scheduling

| Icon | Name |
|------|------|
| Event | `event` |
| Schedule | `schedule` |
| Timer | `timer` |

### Tools & Settings

| Icon | Name |
|------|------|
| Terminal | `terminal` |
| Settings | `settings` |
| Tune | `tune` |
| Search | `search` |
| Visibility | `visibility` |

### Files

| Icon | Name |
|------|------|
| Save | `save` |
| Upload | `upload` |
| Download | `download` |
| Edit | `edit` |
| Delete | `delete` |
| Folder | `folder` |
| Description/doc | `description` |
| Attach file | `attachFile` |

### Usage

```
@flowWeaver nodeType
@icon database
```

Or inline on instances:
```
@node myDb fetchData [icon: "database"] [color: "blue"]
```
