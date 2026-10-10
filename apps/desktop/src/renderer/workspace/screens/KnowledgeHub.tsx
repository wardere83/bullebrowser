import { useState } from 'react';
import type { KnowledgeTab } from '../../state/workspace-store.js';
import {
  useCan,
  useFundingEvent,
  useRouteParams,
  useWorkspaceStore,
} from '../../state/workspace-store.js';
import { fundingBridge, unwrap, useAsync } from '../../lib/funding-client.js';
import { KNOWLEDGE_HUB_DESCRIPTION } from '../copy.js';
import { useConsentGate } from '../ConsentGate.js';
import { DocumentsTab } from '../knowledge/DocumentsTab.js';
import { PrioritiesTab } from '../knowledge/PrioritiesTab.js';
import { SearchTab } from '../knowledge/SearchTab.js';
import { ProfileTab } from '../knowledge/ProfileTab.js';
import { useProfileData } from '../knowledge/useProfileData.js';
import { tallyDocuments } from '../knowledge/documents.js';
import { KNOWLEDGE_TABS, readRequest } from '../knowledge/tabs.js';
import { Screen, TabPanel, Tabs } from '../ui/index.js';

export function KnowledgeHub() {
  const request = readRequest(useRouteParams('knowledge'));
  const navigate = useWorkspaceStore((state) => state.navigate);
  const documents = useAsync(() => unwrap(fundingBridge().knowledge.listDocuments()), []);
  const assistant = useAsync(() => unwrap(fundingBridge().identity.assistant()), []);
  const profile = useProfileData();
  const consent = useConsentGate();
  const canManage = useCan('knowledge.manage');
  const canApprove = useCan('profile.approve');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useFundingEvent(['documents_changed'], documents.reload);
  const tab: KnowledgeTab = request.tab ?? 'documents';
  const open = (next: KnowledgeTab) => navigate('knowledge', { tab: next });
  return (
    <Screen title="Organization Knowledge Hub" description={KNOWLEDGE_HUB_DESCRIPTION}>
      <div className="flex flex-col gap-6">
        <Tabs
          id="knowledge-tabs"
          label="Organization knowledge"
          tabs={KNOWLEDGE_TABS}
          value={tab}
          onChange={open}
        />
        <TabPanel tabsId="knowledge-tabs" tab={tab}>
          {tab === 'documents' && (
            <DocumentsTab
              documents={documents}
              canManage={canManage}
              focusDocumentId={request.documentId}
              onReviewProfile={() => open('profile')}
            />
          )}
          {tab === 'profile' && (
            <ProfileTab
              data={profile}
              documents={documents.value ? tallyDocuments(documents.value) : null}
              assistant={assistant.value ?? null}
              canManage={canManage}
              canApprove={canApprove}
              runWithConsent={consent.run}
              selected={selected}
              onSelectedChange={setSelected}
              focusField={request.field}
              onFieldFocused={() => open('profile')}
              onOpenDocuments={() => open('documents')}
            />
          )}
          {tab === 'priorities' && (
            <PrioritiesTab data={profile} canManage={canManage} canApprove={canApprove} />
          )}
          {tab === 'search' && <SearchTab />}
        </TabPanel>
      </div>
      {consent.dialog}
    </Screen>
  );
}
