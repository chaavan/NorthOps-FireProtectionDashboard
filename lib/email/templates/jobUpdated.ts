import {
  renderCard,
  renderChangesTable,
  renderEmailDocument,
  renderEmailHeaderBand,
  renderHero,
  renderKeyValueGrid,
  renderKeyValueList,
  renderNoteBody,
  renderPrimaryButton,
} from '@/lib/email/layout';

export type JobUpdatedEmailChange = {
  label: string;
  before: string;
  after: string;
};

export type JobUpdatedEmailProps = {
  jobNumber: string;
  jobName: string | null;
  listNumber: string;
  deliveryDateDisplay: string | null;
  updatedByDisplay: string;
  updatedAtDisplay: string;
  changes: JobUpdatedEmailChange[];
  dashboardUrl: string;
  ctaLabel?: string;
  changeNote?: {
    content: string;
    createdBy: string;
    createdAtDisplay: string;
  } | null;
};

export function buildJobUpdatedPreheader(props: JobUpdatedEmailProps): string {
  const jobLabel = props.jobName
    ? `${props.jobNumber} · ${props.jobName}`
    : props.jobNumber;
  const changeSummary =
    props.changes.length === 1
      ? props.changes[0].label
      : `${props.changes.length} fields updated`;
  const noteHint = props.changeNote ? ' · includes note' : '';
  return `${jobLabel} updated by ${props.updatedByDisplay} · ${changeSummary}${noteHint}`;
}

export function buildJobUpdatedEmailHtml(props: JobUpdatedEmailProps): string {
  const {
    jobNumber,
    jobName,
    listNumber,
    deliveryDateDisplay,
    updatedByDisplay,
    updatedAtDisplay,
    changes,
    dashboardUrl,
    ctaLabel = 'Open job in dashboard',
    changeNote,
  } = props;

  const jobSubtitle = jobName ? `${jobNumber} · ${jobName}` : jobNumber;

  const keyFacts = [
    { label: 'Updated by', value: updatedByDisplay },
    { label: 'Updated', value: updatedAtDisplay },
    { label: 'List', value: listNumber },
  ];
  if (deliveryDateDisplay) {
    keyFacts.push({ label: 'Delivery', value: deliveryDateDisplay });
  }

  const changesSection = renderCard({
    title: 'Changes',
    children: renderChangesTable(changes),
  });

  const changeNoteSection = changeNote
    ? renderCard({
        title: 'Note',
        children: `${renderKeyValueList([
          { label: 'Added by', value: changeNote.createdBy },
          { label: 'Date', value: changeNote.createdAtDisplay },
        ])}
        ${renderNoteBody(changeNote.content)}`,
      })
    : '';

  return renderEmailDocument({
    preheader: buildJobUpdatedPreheader(props),
    bodySections: [
      renderEmailHeaderBand('jobUpdated'),
      renderHero({
        title: 'Job information updated',
        subtitle: jobSubtitle,
        intro: `${updatedByDisplay} updated details for this job.`,
      }),
      renderKeyValueGrid(keyFacts.slice(0, 4)),
      changesSection,
      changeNoteSection,
      renderPrimaryButton(dashboardUrl, ctaLabel),
    ],
  });
}
