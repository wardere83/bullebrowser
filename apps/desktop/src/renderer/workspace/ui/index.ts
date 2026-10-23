// The workspace's UI kit. Screens import from here:
//
//   import { Button, Card, Screen, SectionHeading, layout } from '../ui/index.js';
//
// Each component's own file says when to use it. The class strings in
// styles.ts are the design language; compose them rather than writing new
// colours, type sizes or borders in a screen.

export { announce } from './announce.js';
export { Badge, type BadgeProps, type BadgeTone } from './Badge.js';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button.js';
export { Card, type CardProps } from './Card.js';
export { Checkbox, type CheckboxProps } from './Checkbox.js';
export { CitationList, type CitationListProps } from './CitationList.js';
export { DefinitionList, DefinitionRow, type DefinitionRowProps } from './DefinitionList.js';
export { Dialog, type DialogAction, type DialogProps } from './Dialog.js';
export { EmptyState, type EmptyStateProps } from './EmptyState.js';
export { ExternalLink, type ExternalLinkProps } from './ExternalLink.js';
export {
  Field,
  Fieldset,
  Input,
  Select,
  Textarea,
  type FieldProps,
  type FieldsetProps,
  type InputProps,
  type SelectProps,
  type TextareaProps,
} from './Field.js';
export { Icon, ICON_NAMES, Spinner, type IconName } from './icons.js';
export { IconButton, type IconButtonProps } from './IconButton.js';
export { InlineAlert, type AlertTone, type InlineAlertProps } from './InlineAlert.js';
export { linkHost, safeExternalUrl } from './links.js';
export { LoadingBlock, type LoadingBlockProps } from './LoadingBlock.js';
export { Menu, type MenuItem, type MenuProps, type MenuSection } from './Menu.js';
export { ProgressNote, type ProgressNoteProps } from './ProgressNote.js';
export { RadioGroup, type RadioGroupProps, type RadioOption } from './RadioGroup.js';
export { Screen, type ScreenProps } from './Screen.js';
export { SectionHeading, type SectionHeadingProps } from './SectionHeading.js';
export { StatusBadge, type StatusBadgeProps } from './StatusBadge.js';
export {
  ANALYSIS_STATUS,
  CLAIM_STATUS,
  DOCUMENT_STATUS,
  JOB_STATUS,
  OPPORTUNITY_STATUS,
  type StatusKind,
  type StatusPresentation,
} from './status.js';
export { TabPanel, Tabs, type TabPanelProps, type TabSpec, type TabsProps } from './Tabs.js';
export {
  alert,
  badge,
  button,
  card,
  control,
  cx,
  ink,
  layout,
  line,
  surface,
  text,
} from './styles.js';
