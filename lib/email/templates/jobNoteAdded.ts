import {
  renderCard,
  renderEmailDocument,
  renderEmailHeaderBand,
  renderHero,
  renderKeyValueGrid,
  renderNoteBody,
  renderPrimaryButton,
} from '@/lib/email/layout';

export type JobNoteAddedEmailProps = {
  jobNumber: string;
  jobName: string | null;
  listNumber: string;
  deliveryDateDisplay: string | null;
  createdByDisplay: string;
  createdAtDisplay: string;
  noteContent: string;
  isReply: boolean;
  dashboardUrl: string;
};

export function buildJobNoteAddedPreheader(props: JobNoteAddedEmailProps): string {
  const action = props.isReply ? 'New reply' : 'New note';
  const jobLabel = props.jobName
    ? `${props.jobNumber} · ${props.jobName}`
    : props.jobNumber;
  return `${action} on ${jobLabel} by ${props.createdByDisplay}`;
}

export function buildJobNoteAddedEmailHtml(props: JobNoteAddedEmailProps): string {
  const {
    jobNumber,
    jobName,
    listNumber,
    deliveryDateDisplay,
    createdByDisplay,
    createdAtDisplay,
    noteContent,
    isReply,
    dashboardUrl,
  } = props;

  const badgeVariant = 'noteAdded' as const;
  const heroTitle = isReply ? 'New reply on job' : 'New note on job';
  const jobSubtitle = jobName ? `${jobNumber} · ${jobName}` : jobNumber;
  const ctaLabel = isReply ? 'View reply in dashboard' : 'View note in dashboard';

  const keyFacts = [
    { label: 'Added by', value: createdByDisplay },
    { label: 'Date', value: createdAtDisplay },
    { label: 'List', value: listNumber },
  ];
  if (deliveryDateDisplay) {
    keyFacts.push({ label: 'Delivery', value: deliveryDateDisplay });
  }

  const noteSection = renderCard({
    title: isReply ? 'Reply' : 'Note',
    children: renderNoteBody(noteContent),
  });

  return renderEmailDocument({
    preheader: buildJobNoteAddedPreheader(props),
    bodySections: [
      renderEmailHeaderBand(badgeVariant),
      renderHero({
        title: heroTitle,
        subtitle: jobSubtitle,
        intro: `${createdByDisplay} added a ${isReply ? 'reply' : 'note'} on this job.`,
      }),
      renderKeyValueGrid(keyFacts.slice(0, 4)),
      noteSection,
      renderPrimaryButton(dashboardUrl, ctaLabel),
    ],
  });
}
