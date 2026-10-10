import { useState } from 'react';
import {
  KNOWLEDGE_CATEGORY_LABELS,
  type KnowledgeDocument,
  type KnowledgePassage,
} from '../../../shared/funding.js';
import {
  formatDateTime,
  fundingBridge,
  toCallError,
  unwrap,
  type AsyncResult,
} from '../../lib/funding-client.js';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  InlineAlert,
  LoadingBlock,
  Select,
  StatusBadge,
  layout,
  text,
} from '../ui/index.js';
import {
  ACCEPTED_FILES,
  CATEGORIES,
  HELPFUL_DOCUMENTS,
  documentFacts,
  sortDocuments,
} from './documents.js';
import { PassageResults } from './SearchTab.js';

export function DocumentsTab({
  documents,
  canManage,
  focusDocumentId,
  onReviewProfile,
}: {
  documents: AsyncResult<KnowledgeDocument[]>;
  canManage: boolean;
  focusDocumentId: string | null;
  onReviewProfile(): void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [remove, setRemove] = useState<KnowledgeDocument | null>(null);
  const [preview, setPreview] = useState<{ name: string; passages: KnowledgePassage[] } | null>(
    null,
  );
  const act = async (id: string, call: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(id);
    setError('');
    setNotice('');
    try {
      await call();
      documents.reload();
      setNotice(success);
    } catch (failure) {
      const failed = toCallError(failure);
      if (failed.code !== 'CANCELLED') setError(failed.message);
    } finally {
      setBusy('');
    }
  };
  return (
    <div className={layout.stack}>
      <Card>
        <h2 className={text.h2}>Organization documents</h2>
        <p className={text.body}>
          {ACCEPTED_FILES}. Upload {HELPFUL_DOCUMENTS}.
        </p>
        <p className={text.small}>
          RFPs belong in RFP Analysis. Previous proposals provide historical evidence; review their
          claims against current plans before approving them.
        </p>
        {canManage && (
          <Button
            variant="primary"
            busy={busy === 'upload'}
            disabled={Boolean(busy)}
            onClick={() =>
              void act(
                'upload',
                () => unwrap(fundingBridge().knowledge.addDocuments()),
                'Upload selection processed. Document status shows what is ready.',
              )
            }
          >
            Upload documents
          </Button>
        )}
      </Card>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {notice && <InlineAlert tone="success">{notice}</InlineAlert>}
      {documents.value?.some((document) => document.status === 'ready') && (
        <Card>
          <h2 className={text.h2}>Connect your entity to funding</h2>
          <p className={text.body}>
            Review and approve your entity’s profile from these documents. The four funding options
            then use it automatically to find relevant grants, assess alignment, explore funder
            priorities and guide your proposal.
          </p>
          <Button onClick={onReviewProfile}>Review entity profile</Button>
        </Card>
      )}
      {documents.state === 'loading' && <LoadingBlock label="Loading documents" />}
      {documents.error && (
        <InlineAlert tone="error" action={<Button onClick={documents.reload}>Try again</Button>}>
          {documents.error.message}
        </InlineAlert>
      )}
      {documents.value?.length === 0 && (
        <EmptyState
          icon="library"
          title="No documents yet"
          body="Upload your plans and evidence to build your organization’s knowledge."
        />
      )}
      {sortDocuments(documents.value ?? []).map((document) => (
        <Card
          key={document.id}
          className={focusDocumentId === document.id ? 'ring-2 ring-primary' : ''}
        >
          <div className={layout.row}>
            <h3 className={text.h3}>{document.name}</h3>
            <StatusBadge kind="document" status={document.status} />
          </div>
          <p className={text.caption}>
            {documentFacts(document).join(' · ')} · Updated {formatDateTime(document.updatedAt)}
          </p>
          {document.statusDetail && (
            <InlineAlert tone="caution">{document.statusDetail}</InlineAlert>
          )}
          {document.warnings.map((warning, index) => (
            <InlineAlert key={index} tone="caution">
              {warning}
            </InlineAlert>
          ))}
          <Field label={`Category for ${document.name}`}>
            <Select
              disabled={!canManage || Boolean(busy)}
              value={document.category}
              onChange={(event) =>
                void act(
                  document.id,
                  () =>
                    unwrap(
                      fundingBridge().knowledge.setCategory(
                        document.id,
                        event.target.value as KnowledgeDocument['category'],
                      ),
                    ),
                  'Document category updated.',
                )
              }
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {KNOWLEDGE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </Field>
          <div className={layout.row}>
            <Button
              disabled={document.status !== 'ready' || Boolean(busy)}
              onClick={() =>
                void act(
                  document.id,
                  async () =>
                    setPreview({
                      name: document.name,
                      passages: await unwrap(
                        fundingBridge().knowledge.documentPassages(document.id),
                      ),
                    }),
                  '',
                )
              }
            >
              Inspect {document.name}
            </Button>
            {canManage && (
              <>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void act(
                      document.id,
                      () => unwrap(fundingBridge().knowledge.replaceDocument(document.id)),
                      'Replacement selection processed. Related profile claims require review.',
                    )
                  }
                >
                  Replace {document.name}
                </Button>
                {document.status === 'failed' && (
                  <Button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act(
                        document.id,
                        () => unwrap(fundingBridge().knowledge.retryDocument(document.id)),
                        'Reading document again.',
                      )
                    }
                  >
                    Retry {document.name}
                  </Button>
                )}
                <Button
                  variant="quiet"
                  disabled={Boolean(busy)}
                  onClick={() => setRemove(document)}
                >
                  Delete {document.name}
                </Button>
              </>
            )}
          </div>
        </Card>
      ))}
      <Dialog
        open={Boolean(remove)}
        onClose={() => setRemove(null)}
        title="Delete document"
        description={`Remove ${remove?.name ?? ''} from this organization? Its passages are removed from search, and claims based on it require review.`}
        primaryAction={{
          label: 'Delete document',
          variant: 'danger',
          busy: busy === remove?.id,
          onClick: () => {
            if (remove)
              void act(
                remove.id,
                () => unwrap(fundingBridge().knowledge.deleteDocument(remove.id)),
                'Document deleted. Related profile claims require review.',
              ).then(() => setRemove(null));
          },
        }}
        secondaryAction={{ label: 'Keep document' }}
      />
      <Dialog
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview ? `Extracted text: ${preview.name}` : 'Extracted text'}
        size="lg"
      >
        <div className="max-h-[60vh] overflow-y-auto">
          {preview && <PassageResults passages={preview.passages} />}
        </div>
      </Dialog>
    </div>
  );
}
