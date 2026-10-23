import type { ApiTool, TabSummary } from './types.js';

/** Browser-backed connectors use the user's real signed-in surface. No token scraping. */
export const CONNECTORS = [
  {
    id: 'google-drive',
    name: 'Google Drive',
    url: 'https://drive.google.com/drive/u/0/home',
    description: 'Find documents and work with your files.',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    url: 'https://mail.google.com/mail/u/0/',
    description: 'Read messages and prepare replies.',
  },
  {
    id: 'microsoft-365',
    name: 'Microsoft 365',
    url: 'https://www.microsoft365.com/',
    description: 'Work with Word, Excel and your cloud files.',
  },
  {
    id: 'outlook',
    name: 'Outlook',
    url: 'https://outlook.office.com/mail/',
    description: 'Review mail and prepare messages.',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    url: 'https://login.salesforce.com/',
    description: 'Open your customer workspace.',
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    url: 'https://app.hubspot.com/',
    description: 'Work with contacts and customer records.',
  },
  {
    id: 'notion',
    name: 'Notion',
    url: 'https://www.notion.so/',
    description: 'Read and update your workspace pages.',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    url: 'https://calendar.google.com/',
    description: 'Review schedules and prepare events.',
  },
  {
    id: 'google-contacts',
    name: 'Google Contacts',
    url: 'https://contacts.google.com/',
    description: 'Find and maintain contact records.',
  },
  {
    id: 'google-docs',
    name: 'Google Docs',
    url: 'https://docs.google.com/',
    description: 'Read and edit documents.',
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    url: 'https://sheets.google.com/',
    description: 'Work with spreadsheets.',
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    url: 'https://onedrive.live.com/',
    description: 'Find and organize cloud files.',
  },
  {
    id: 'sharepoint',
    name: 'SharePoint',
    url: 'https://www.microsoft365.com/',
    description: 'Open your organization’s SharePoint through Microsoft 365.',
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    url: 'https://teams.microsoft.com/',
    description: 'Work with conversations and meetings.',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    url: 'https://www.dropbox.com/home',
    description: 'Find and organize shared files.',
  },
  {
    id: 'box',
    name: 'Box',
    url: 'https://app.box.com/',
    description: 'Review organization documents.',
  },
  {
    id: 'github',
    name: 'GitHub',
    url: 'https://github.com/',
    description: 'Inspect repositories, issues and pull requests.',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    url: 'https://gitlab.com/',
    description: 'Review code and project work.',
  },
  {
    id: 'linear',
    name: 'Linear',
    url: 'https://linear.app/',
    description: 'Review and update issues.',
  },
  {
    id: 'asana',
    name: 'Asana',
    url: 'https://app.asana.com/',
    description: 'Work with projects and tasks.',
  },
  {
    id: 'atlassian',
    name: 'Jira and Confluence',
    url: 'https://start.atlassian.com/',
    description: 'Open your projects and knowledge pages.',
  },
  {
    id: 'monday',
    name: 'monday.com',
    url: 'https://auth.monday.com/',
    description: 'Review boards and project progress.',
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    url: 'https://app.clickup.com/',
    description: 'Work with tasks and documents.',
  },
  {
    id: 'trello',
    name: 'Trello',
    url: 'https://trello.com/',
    description: 'Organize work on boards.',
  },
  {
    id: 'airtable',
    name: 'Airtable',
    url: 'https://airtable.com/',
    description: 'Review tables and records.',
  },
  {
    id: 'canva',
    name: 'Canva',
    url: 'https://www.canva.com/',
    description: 'Open and work with designs.',
  },
  {
    id: 'figma',
    name: 'Figma',
    url: 'https://www.figma.com/',
    description: 'Inspect design files and feedback.',
  },
  {
    id: 'adobe',
    name: 'Adobe Creative Cloud',
    url: 'https://creativecloud.adobe.com/',
    description: 'Find creative files and web tools.',
  },
  {
    id: 'miro',
    name: 'Miro',
    url: 'https://miro.com/',
    description: 'Work with collaboration boards.',
  },
  {
    id: 'zoom',
    name: 'Zoom',
    url: 'https://zoom.us/signin',
    description: 'Review meetings and recordings.',
  },
  {
    id: 'docusign',
    name: 'Docusign',
    url: 'https://apps.docusign.com/',
    description: 'Review agreements; signatures require approval.',
  },
  {
    id: 'intercom',
    name: 'Intercom',
    url: 'https://app.intercom.com/',
    description: 'Review customer conversations.',
  },
  {
    id: 'zendesk',
    name: 'Zendesk',
    url: 'https://www.zendesk.com/login/',
    description: 'Open your support workspace.',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    url: 'https://dashboard.stripe.com/',
    description: 'Review payments; changes require approval.',
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    url: 'https://qbo.intuit.com/',
    description: 'Review accounting records.',
  },
  {
    id: 'xero',
    name: 'Xero',
    url: 'https://login.xero.com/',
    description: 'Review accounting work.',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    url: 'https://admin.shopify.com/',
    description: 'Review your store and orders.',
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    url: 'https://login.mailchimp.com/',
    description: 'Prepare campaigns and review audiences.',
  },
  {
    id: 'wordpress',
    name: 'WordPress',
    url: 'https://wordpress.com/',
    description: 'Prepare pages and posts.',
  },
  {
    id: 'webflow',
    name: 'Webflow',
    url: 'https://webflow.com/dashboard',
    description: 'Review sites and content.',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    url: 'https://supabase.com/dashboard',
    description: 'Inspect your project workspace.',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    url: 'https://vercel.com/dashboard',
    description: 'Review projects and deployments.',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    url: 'https://dash.cloudflare.com/',
    description: 'Review your web infrastructure.',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    url: 'https://sentry.io/',
    description: 'Review application errors.',
  },
  {
    id: 'amplitude',
    name: 'Amplitude',
    url: 'https://app.amplitude.com/',
    description: 'Review product analytics.',
  },
  {
    id: 'zapier',
    name: 'Zapier',
    url: 'https://zapier.com/app/home',
    description: 'Review and prepare automations.',
  },
  {
    id: 'make',
    name: 'Make',
    url: 'https://www.make.com/',
    description: 'Open your automation workspace.',
  },
  {
    id: 'n8n',
    name: 'n8n',
    url: 'https://app.n8n.cloud/',
    description: 'Review automation workflows.',
  },
  {
    id: 'workato',
    name: 'Workato',
    url: 'https://app.workato.com/',
    description: 'Work with integration recipes.',
  },
  {
    id: 'slack',
    name: 'Slack',
    url: 'https://app.slack.com/',
    description: 'Find conversations and prepare messages.',
  },
] as const;

export type ConnectorId = string;
export interface ConnectorDefinition {
  id: string;
  name: string;
  url: string;
  description: string;
  custom?: boolean;
}
export interface ConnectorState extends ConnectorDefinition {
  enabled: boolean;
}
export function customConnector(id: string, name: unknown, address: unknown): ConnectorDefinition {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.trim().length > 80 ||
    typeof address !== 'string'
  )
    throw new Error('Enter a service name and HTTPS address.');
  const url = new URL(address);
  const host = url.hostname;
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !host.includes('.') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host)
  )
    throw new Error('Use a public HTTPS service address without credentials.');
  url.hash = '';
  return {
    id,
    name: name.trim(),
    url: url.href,
    description: 'Your custom browser connector.',
    custom: true,
  };
}
export function connectorFor(id: unknown) {
  return CONNECTORS.find((entry) => entry.id === id);
}
export function normalizeConnectors(value: unknown): ConnectorId[] {
  return Array.isArray(value)
    ? CONNECTORS.filter((entry) => value.includes(entry.id)).map((entry) => entry.id)
    : [];
}

export interface ConnectorHost {
  /** Resolve current permissions at execution time, including revocations. */
  enabled(): Promise<ConnectorId[]>;
  catalog?(): Promise<readonly ConnectorDefinition[]>;
  /** Must request task browsing consent; Settings is not consequential-action approval. */
  authorize(): Promise<boolean>;
  open(id: ConnectorId, url: string): Promise<TabSummary>;
}
export function connectorTools(host: ConnectorHost): ApiTool[] {
  return [
    {
      name: 'connector_list',
      description:
        'List user-enabled browser connectors. Enabled does not mean signed in. Use existing browser tools after opening; consequential actions still require approval.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        const enabled = await host.enabled();
        const catalog = host.catalog ? await host.catalog() : CONNECTORS;
        return catalog
          .filter((entry) => enabled.includes(entry.id))
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            mode: 'browser',
            authentication: 'sign in in the browser if needed',
          }));
      },
    },
    {
      name: 'connector_open',
      description:
        'Open a user-enabled connector in a real browser tab. No API credentials or login state are returned. Continue with the existing browser tools and their safety confirmations.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', maxLength: 100 } },
        required: ['id'],
        additionalProperties: false,
      },
      execute: async (input) => {
        const catalog = host.catalog ? await host.catalog() : CONNECTORS;
        const connector = catalog.find((entry) => entry.id === input.id);
        if (!connector || !(await host.enabled()).includes(connector.id))
          throw new Error('Enable this connector in Settings first.');
        if (!(await host.authorize())) throw new Error('Browser access was declined.');
        // A permission may have been revoked while the consent prompt was open.
        if (!(await host.enabled()).includes(connector.id))
          throw new Error('Connector access was revoked.');
        return host.open(connector.id, connector.url);
      },
    },
  ];
}
