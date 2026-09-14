/**
 * The Host's surface.
 *
 * The port types are re-exported rather than left in @hatua/services: a Host
 * implements them and never installs that package, so making it reach past
 * @hatua/react for the type of the thing it is being asked to write would be a
 * seam that exists only in our directory layout.
 */
/**
 * The vocabulary a region's props are written in.
 *
 * Re-exported for the reason the ports are: a Host holds the selection and the
 * Board on screen — `<StepList>`, `<FlowMap>`, `<Inspector>` and `<Data>` all
 * take them — and making it install @hatua/model to name the type of a thing it
 * is being handed would be a seam that exists only in our directory layout.
 */
export type { BoardId, Segment, StepRef } from '@hatua/model'
export type {
  ContextKey,
  Field,
  Manifest,
  ManifestEntry,
  RunContextManifest,
  Step,
  Trigger,
  Variable,
  WorkflowDefinition,
} from '@hatua/schema'
export type {
  ConnectionDescriber,
  ConnectionDescription,
  ConnectionSource,
  ConnectionSummary,
  Cursor,
  DraftSession,
  EditToken,
  InsertPoint,
  Lease,
  ManifestSource,
  PublishedVersion,
  VersionSummary,
  WorkflowStore,
} from '@hatua/services'
export type {
  ComponentDrag,
  ComponentsProps,
  DataProps,
  FlowMapProps,
  InspectorProps,
  PanelTab,
  StepListProps,
  TabbedPanelProps,
  TopBarProps,
  Viewport,
  WorkflowProps,
} from './layouts'
export {
  Components,
  Data,
  FlowMap,
  Inspector,
  StepList,
  TabbedPanel,
  TopBar,
  Workflow,
} from './layouts'
export type {
  ButtonProps,
  ButtonSize,
  ButtonVariant,
  ConfirmDialogProps,
  InputProps,
  SelectProps,
  ToastProps,
  ToastTone,
  ToggleProps,
  TooltipProps,
} from './primitives'
export { Button, ConfirmDialog, Input, Select, Toast, Toggle, Tooltip } from './primitives'
export type { Theme, ThemeSeed } from './theme/createTheme'
export { createTheme } from './theme/createTheme'
export type { ColorMode, HatuaProviderProps, HostPorts } from './theme/HatuaProvider'
export { HatuaProvider } from './theme/HatuaProvider'
export type { BuildProps } from './views/Build'
export { Build } from './views/Build'
export type { HatuaProps } from './views/Hatua'
export { Hatua } from './views/Hatua'
