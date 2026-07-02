import { formatSystemRole } from '@/lib/email/formatLabels';
import {
  renderAccessLevelPill,
  renderCard,
  renderEmailDocument,
  renderEmailHeaderBand,
  renderHero,
  renderKeyValueGrid,
  renderKeyValueList,
  renderMutedText,
  renderPrimaryButton,
} from '@/lib/email/layout';

export type JobAccessAddedEmailProps = {
  recipientName: string;
  jobNumber: string;
  jobName: string | null;
  listNumber: string;
  grantedBy: string;
  grantedByRole?: string | null;
  grantedAtDisplay: string;
  dashboardUrl: string;
};

export function buildJobAccessAddedPreheader(
  props: JobAccessAddedEmailProps,
): string {
  return `You were added to job ${props.jobNumber}`;
}

export function buildJobAccessAddedEmailHtml(
  props: JobAccessAddedEmailProps,
): string {
  const {
    recipientName,
    jobNumber,
    jobName,
    listNumber,
    grantedBy,
    grantedByRole,
    grantedAtDisplay,
    dashboardUrl,
  } = props;

  const roleLabel = formatSystemRole(grantedByRole);
  const grantedByDisplay = roleLabel ? `${grantedBy} (${roleLabel})` : grantedBy;
  const jobSubtitle = jobName ? `${jobNumber} · ${jobName}` : jobNumber;

  const accessCard = renderCard({
    title: 'Your access',
    children: `${renderAccessLevelPill('Access granted')}
      ${renderMutedText('Your access on this job follows your normal account permissions.')}
      ${renderKeyValueList([
        { label: 'Granted by', value: grantedByDisplay },
        { label: 'Granted at', value: grantedAtDisplay },
      ])}`,
  });

  return renderEmailDocument({
    preheader: buildJobAccessAddedPreheader(props),
    bodySections: [
      renderEmailHeaderBand('accessGranted'),
      renderHero({
        title: `Hello, ${recipientName}`,
        subtitle: jobSubtitle,
        intro: 'You have been granted access to this job in the Total Fire Protection dashboard.',
      }),
      renderKeyValueGrid([
        { label: 'Job', value: jobNumber },
        { label: 'List', value: listNumber },
      ]),
      accessCard,
      renderPrimaryButton(dashboardUrl, 'Open job in dashboard'),
    ],
  });
}
