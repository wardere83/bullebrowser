import type { ReactNode } from 'react';
import { SectionHeading } from './SectionHeading.js';
import { layout } from './styles.js';

export interface ScreenProps {
  /** The screen's name. Rendered as the one h1. */
  title: ReactNode;
  /** One or two sentences saying what the screen is for. */
  description?: ReactNode;
  /** Something small beside the title, such as a Badge. */
  titleAddon?: ReactNode;
  /** The screen's main actions, to the right of the title. */
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * The frame every workspace screen returns: the screen's one h1 with its
 * description, then the screen's sections at the standard spacing. Render it
 * at once, even while data is loading, and put loading, empty and error states
 * inside it, so the title is always there for the workspace to move focus to.
 */
export function Screen({ title, description, titleAddon, actions, children }: ScreenProps) {
  return (
    <div className={layout.screen}>
      <SectionHeading
        level={1}
        title={title}
        description={description}
        addon={titleAddon}
        actions={actions}
      />
      {children}
    </div>
  );
}
