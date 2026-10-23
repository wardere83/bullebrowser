import { useState } from 'react';
import type { KnowledgePassage } from '../../../shared/funding.js';
import { fundingBridge, toCallError, unwrap } from '../../lib/funding-client.js';
import { Button, Card, Field, Input, InlineAlert, EmptyState, layout, text } from '../ui/index.js';
import { passageKey, passagePlace } from './passages.js';
import { PassageQuote } from './Pieces.js';

export function PassageResults({ passages }: { passages: KnowledgePassage[] }) {
  return (
    <div className={layout.stack}>
      {passages.map((passage) => (
        <Card key={passageKey(passage)}>
          <p className={text.h3}>{passage.documentName}</p>
          <p className={text.caption}>
            Version {passage.documentVersion} · {passagePlace(passage) || 'Document text'}
          </p>
          <PassageQuote>{passage.text}</PassageQuote>
        </Card>
      ))}
    </div>
  );
}

export function SearchTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgePassage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className={layout.stack}>
      <p className={text.body}>
        Search readable documents in this organization. Results quote the original text and identify
        its source.
      </p>
      <form
        className={layout.stack}
        onSubmit={(event) => {
          event.preventDefault();
          if (!query.trim() || busy) return;
          setBusy(true);
          setError('');
          setResults(null);
          void unwrap(fundingBridge().knowledge.search(query.trim(), 20))
            .then(setResults)
            .catch((failure) => setError(toCallError(failure).message))
            .finally(() => setBusy(false));
        }}
      >
        <Field label="Search organization documents">
          <Input maxLength={500} value={query} onChange={(event) => setQuery(event.target.value)} />
        </Field>
        <Button type="submit" busy={busy} disabled={!query.trim()} variant="primary">
          Search documents
        </Button>
      </form>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {results?.length === 0 && (
        <EmptyState
          icon="search"
          title="No passages found"
          body="Try another phrase, or check that your documents are ready in Documents."
        />
      )}
      {results && <PassageResults passages={results} />}
    </div>
  );
}
