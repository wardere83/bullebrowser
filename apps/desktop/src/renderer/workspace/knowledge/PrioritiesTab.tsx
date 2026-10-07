import { Button, Card, InlineAlert, LoadingBlock, layout, text } from '../ui/index.js';
import { ClaimList } from './ClaimItem.js';
import { useClaimActions } from './useClaimActions.js';
import type { ProfileData } from './useProfileData.js';

export function PrioritiesTab({
  data,
  canManage,
  canApprove,
}: {
  data: ProfileData;
  canManage: boolean;
  canApprove: boolean;
}) {
  const actions = useClaimActions({
    profile: data.profile,
    apply: data.apply,
    canManage,
    canApprove,
  });
  const claims =
    data.profile?.claims.filter(
      (claim) => claim.field === 'strategic_priorities' || claim.field === 'funding_goals',
    ) ?? [];
  return (
    <div className={layout.stack} ref={actions.rootRef}>
      <Card>
        <h2 className={text.h2}>Our Priorities</h2>
        <p className={text.body}>
          Approved priorities and funding goals guide discovery and alignment. Review every proposed
          change before it becomes part of your organization’s profile.
        </p>
        {canManage && (
          <div className={layout.row}>
            <Button
              onClick={() =>
                actions.add('strategic_priorities', {
                  title: 'Add a priority',
                  submitLabel: 'Propose priority',
                })
              }
            >
              Add a priority
            </Button>
            <Button
              onClick={() =>
                actions.add('funding_goals', {
                  title: 'Add a funding goal',
                  submitLabel: 'Propose funding goal',
                })
              }
            >
              Add a funding goal
            </Button>
          </div>
        )}
      </Card>
      {data.loading && <LoadingBlock label="Loading priorities" />}
      {data.error && (
        <InlineAlert tone="error" action={<Button onClick={data.reload}>Try again</Button>}>
          {data.error.message}
        </InlineAlert>
      )}
      {!data.loading && claims.length === 0 && (
        <p className={text.body}>
          No priorities yet. Draft your profile from documents, or add a priority for review.
        </p>
      )}
      <ClaimList
        label="Approved priorities and funding goals"
        claims={claims.filter((claim) => claim.status === 'approved')}
        actions={actions}
      />
      <ClaimList
        label="Proposed — awaiting approval"
        claims={claims.filter((claim) => claim.status === 'proposed')}
        actions={actions}
      />
      <ClaimList
        label="Needs review — excluded from guidance"
        claims={claims.filter((claim) => claim.status === 'needs_review')}
        actions={actions}
      />
      {actions.dialogs}
    </div>
  );
}
