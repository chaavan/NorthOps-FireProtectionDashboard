/**
 * Seed the CRM with a lived-in demo dataset: accounts, locations, contacts, one
 * completed inspection per account carrying deficiencies, a matching opportunity
 * for each deficiency spanning every pipeline stage, renewals, an activity
 * timeline, tasks, and tags.
 *
 * Every value here is invented. Companies and people are fictional, email
 * domains use the RFC 2606 reserved `example.com`, phone numbers use the
 * reserved 555-01xx range, and street addresses are placeholders. Nothing in
 * this file corresponds to a real customer.
 *
 * Rows are stamped with SEED_MARK so they can be wiped without touching
 * anything a human entered:
 *
 *   CRM_DEMO_SEED_CONFIRM=I_UNDERSTAND npm run db:seed-crm-demo
 *   CRM_DEMO_SEED_CONFIRM=I_UNDERSTAND npm run db:seed-crm-demo -- --clean
 *
 * Re-running reseeds from scratch (it cleans first), so it is idempotent.
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";

const SEED_MARK = process.env.CRM_DEMO_SEED_ACTOR?.trim() || "demo-seed@northops.local";

const REPS = [
  "avery.brooks@northops.local",
  "jordan.imani@northops.local",
  "sam.okonkwo@northops.local",
  "riley.nakamura@northops.local",
];

const OPP_STAGES = [
  "DEFICIENCY_IDENTIFIED",
  "QUOTED",
  "SENT",
  "WON",
  "LOST",
  "SCHEDULED",
] as const;

const TAGS = [
  { name: "VIP", color: "#f59e0b" },
  { name: "National Account", color: "#3b82f6" },
  { name: "Multi-Site", color: "#8b5cf6" },
  { name: "Priority Renewal", color: "#ef4444" },
  { name: "Healthcare", color: "#10b981" },
  { name: "Education", color: "#06b6d4" },
  { name: "Industrial", color: "#64748b" },
  { name: "Net-30", color: "#a3e635" },
];

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length];
}

type AccountSpec = {
  name: string;
  accountType: string;
  rep: string;
  locations: Array<{
    name: string;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
  }>;
  contacts: Array<{ name: string; role: string; email: string; phone: string; primary?: boolean }>;
  deficiencies: Array<{
    title: string;
    description: string;
    severity: string;
    value: number;
    stage: (typeof OPP_STAGES)[number];
    status: string;
  }>;
  renewals: Array<{
    contractName: string;
    serviceType: string;
    days: number;
    annualValue: number;
    status: string;
  }>;
  tags: string[];
};

const ACCOUNTS: AccountSpec[] = [
  {
    name: "Alderwood Property Group",
    accountType: "national",
    rep: REPS[0],
    locations: [
      { name: "Alderwood Tower", addressLine1: "100 Example Plaza", city: "Columbus", state: "OH", postalCode: "43215" },
      { name: "Alderwood West Campus", addressLine1: "420 Sample Ridge Rd", city: "Dublin", state: "OH", postalCode: "43017" },
    ],
    contacts: [
      { name: "Dana Whitfield", role: "PROPERTY_MANAGER", email: "d.whitfield@alderwood.example.com", phone: "614-555-0142", primary: true },
      { name: "Marcus Bell", role: "FACILITIES_DIRECTOR", email: "m.bell@alderwood.example.com", phone: "614-555-0177" },
    ],
    deficiencies: [
      { title: "Corroded sprinkler heads — parking garage P2", description: "18 heads showing corrosion; replacement recommended within 30 days.", severity: "MAJOR", value: 8400, stage: "SENT", status: "QUOTED" },
      { title: "Fire alarm panel battery failure", description: "Backup batteries below threshold on Panel A.", severity: "CRITICAL", value: 1250, stage: "WON", status: "REPAIRED" },
      { title: "Expired extinguisher tags (24 units)", description: "Annual service overdue across both towers.", severity: "MINOR", value: 960, stage: "SCHEDULED", status: "QUOTED" },
    ],
    renewals: [
      { contractName: "Annual Inspection & Testing — Portfolio", serviceType: "INSPECTION_TESTING", days: 22, annualValue: 42000, status: "PENDING_RENEWAL" },
      { contractName: "24/7 Alarm Monitoring", serviceType: "MONITORING", days: 140, annualValue: 9600, status: "ACTIVE" },
    ],
    tags: ["VIP", "National Account", "Multi-Site"],
  },
  {
    name: "Brightwater Medical Center",
    accountType: "direct",
    rep: REPS[1],
    locations: [
      { name: "Brightwater Main Hospital", addressLine1: "250 Placeholder Dr", city: "Madison", state: "WI", postalCode: "53703" },
    ],
    contacts: [
      { name: "Priya Raman", role: "FACILITIES_DIRECTOR", email: "p.raman@brightwatermed.example.com", phone: "608-555-0119", primary: true },
      { name: "Tom Cardoso", role: "SAFETY_OFFICER", email: "t.cardoso@brightwatermed.example.com", phone: "608-555-0164" },
    ],
    deficiencies: [
      { title: "Standpipe hydrostatic test overdue", description: "Five-year test past due on the east riser.", severity: "MAJOR", value: 6200, stage: "QUOTED", status: "OPEN" },
      { title: "Blocked sprinkler clearance — supply storage", description: "Stock stacked within 18in of deflectors in two bays.", severity: "MAJOR", value: 0, stage: "DEFICIENCY_IDENTIFIED", status: "OPEN" },
      { title: "Emergency light battery replacements", description: "Twelve fixtures failed the 90-minute duration test.", severity: "MINOR", value: 2150, stage: "WON", status: "REPAIRED" },
    ],
    renewals: [
      { contractName: "Life-Safety Inspection Program", serviceType: "INSPECTION_TESTING", days: 55, annualValue: 38500, status: "ACTIVE" },
    ],
    tags: ["Healthcare", "VIP"],
  },
  {
    name: "Copperfield Apartments LLC",
    accountType: "direct",
    rep: REPS[2],
    locations: [
      { name: "Copperfield Commons", addressLine1: "78 Specimen Ave", city: "Boise", state: "ID", postalCode: "83702" },
    ],
    contacts: [
      { name: "Elena Marsh", role: "PROPERTY_MANAGER", email: "e.marsh@copperfieldapts.example.com", phone: "208-555-0173", primary: true },
      { name: "Wes Duarte", role: "MAINTENANCE_LEAD", email: "w.duarte@copperfieldapts.example.com", phone: "208-555-0128" },
    ],
    deficiencies: [
      { title: "Dry system low-air alarm recurring", description: "Compressor short-cycling on Building C.", severity: "MAJOR", value: 4300, stage: "SENT", status: "QUOTED" },
      { title: "Missing escutcheons — 31 units", description: "Escutcheon rings absent across renovated units.", severity: "MINOR", value: 1240, stage: "LOST", status: "OPEN" },
    ],
    renewals: [
      { contractName: "Annual Sprinkler Inspection", serviceType: "INSPECTION_TESTING", days: 8, annualValue: 12800, status: "PENDING_RENEWAL" },
    ],
    tags: ["Multi-Site", "Priority Renewal"],
  },
  {
    name: "Dunmore Office Towers",
    accountType: "national",
    rep: REPS[3],
    locations: [
      { name: "Dunmore North Tower", addressLine1: "1500 Illustration Blvd", city: "Tampa", state: "FL", postalCode: "33602" },
      { name: "Dunmore South Tower", addressLine1: "1520 Illustration Blvd", city: "Tampa", state: "FL", postalCode: "33602" },
    ],
    contacts: [
      { name: "Grace Adeyemi", role: "PROPERTY_MANAGER", email: "g.adeyemi@dunmoretowers.example.com", phone: "813-555-0150", primary: true },
      { name: "Victor Hsu", role: "CHIEF_ENGINEER", email: "v.hsu@dunmoretowers.example.com", phone: "813-555-0191" },
    ],
    deficiencies: [
      { title: "Fire pump churn test failure", description: "Pump failed to reach rated pressure during weekly churn.", severity: "CRITICAL", value: 15400, stage: "SENT", status: "QUOTED" },
      { title: "Control valve not supervised", description: "Two OS&Y valves lack tamper supervision.", severity: "MAJOR", value: 3600, stage: "SCHEDULED", status: "QUOTED" },
      { title: "Annual backflow certification", description: "Certification lapsed on the south tower assembly.", severity: "MINOR", value: 780, stage: "WON", status: "REPAIRED" },
    ],
    renewals: [
      { contractName: "Full Life-Safety Program", serviceType: "INSPECTION_TESTING", days: 31, annualValue: 56000, status: "PENDING_RENEWAL" },
      { contractName: "Fire Pump Service Agreement", serviceType: "MAINTENANCE", days: 210, annualValue: 14200, status: "ACTIVE" },
    ],
    tags: ["National Account", "VIP", "Multi-Site"],
  },
  {
    name: "Elmridge Shopping Center",
    accountType: "direct",
    rep: REPS[0],
    locations: [
      { name: "Elmridge Mall", addressLine1: "900 Demonstration Way", city: "Ocala", state: "FL", postalCode: "34470" },
    ],
    contacts: [
      { name: "Nadia Kovacs", role: "OPERATIONS_MANAGER", email: "n.kovacs@elmridgesc.example.com", phone: "352-555-0198", primary: true },
      { name: "Owen Pratt", role: "MAINTENANCE_LEAD", email: "o.pratt@elmridgesc.example.com", phone: "352-555-0107" },
    ],
    deficiencies: [
      { title: "Kitchen suppression nozzle misalignment", description: "Two food-court hoods have misaligned nozzles.", severity: "MAJOR", value: 2900, stage: "QUOTED", status: "OPEN" },
      { title: "Exit sign outages (nine locations)", description: "Illumination failed during the monthly walk.", severity: "MINOR", value: 1150, stage: "WON", status: "REPAIRED" },
    ],
    renewals: [
      { contractName: "Annual Inspection & Testing", serviceType: "INSPECTION_TESTING", days: 96, annualValue: 19400, status: "ACTIVE" },
    ],
    tags: ["Net-30"],
  },
  {
    name: "Fairhaven Logistics",
    accountType: "national",
    rep: REPS[1],
    locations: [
      { name: "Fairhaven Distribution Center", addressLine1: "3300 Fictional Commerce Dr", city: "Ogden", state: "UT", postalCode: "84401" },
    ],
    contacts: [
      { name: "Ibrahim Sultani", role: "SAFETY_OFFICER", email: "i.sultani@fairhavenlog.example.com", phone: "801-555-0164", primary: true },
      { name: "Lena Ostrowski", role: "FACILITIES_DIRECTOR", email: "l.ostrowski@fairhavenlog.example.com", phone: "801-555-0135" },
    ],
    deficiencies: [
      { title: "ESFR head obstruction — rack aisle 7", description: "New racking installed above the design clearance.", severity: "CRITICAL", value: 22800, stage: "SENT", status: "QUOTED" },
      { title: "Fire door hold-opens not releasing", description: "Four doors failed to release on alarm.", severity: "MAJOR", value: 3400, stage: "DEFICIENCY_IDENTIFIED", status: "OPEN" },
      { title: "Extinguisher six-year maintenance", description: "Forty-two units due for internal maintenance.", severity: "MINOR", value: 2520, stage: "SCHEDULED", status: "QUOTED" },
    ],
    renewals: [
      { contractName: "Warehouse Life-Safety Program", serviceType: "INSPECTION_TESTING", days: 14, annualValue: 47500, status: "PENDING_RENEWAL" },
    ],
    tags: ["Industrial", "National Account"],
  },
  {
    name: "Glenbrook School District",
    accountType: "direct",
    rep: REPS[2],
    locations: [
      { name: "Glenbrook High School", addressLine1: "55 Example School Rd", city: "Jacksonville", state: "FL", postalCode: "32202" },
      { name: "Glenbrook Middle School", addressLine1: "61 Example School Rd", city: "Jacksonville", state: "FL", postalCode: "32202" },
    ],
    contacts: [
      { name: "Rosa Delacroix", role: "FACILITIES_DIRECTOR", email: "r.delacroix@glenbrookschools.example.com", phone: "904-555-0126", primary: true },
      { name: "Cyrus Mbeki", role: "SAFETY_OFFICER", email: "c.mbeki@glenbrookschools.example.com", phone: "904-555-0188" },
    ],
    deficiencies: [
      { title: "Alarm audibility below code in gymnasium", description: "Measured levels fall short of the required margin.", severity: "MAJOR", value: 7100, stage: "QUOTED", status: "OPEN" },
      { title: "Annual extinguisher service (both campuses)", description: "Combined annual service across the district.", severity: "MINOR", value: 1980, stage: "WON", status: "REPAIRED" },
    ],
    renewals: [
      { contractName: "District Inspection Program", serviceType: "INSPECTION_TESTING", days: 62, annualValue: 27500, status: "ACTIVE" },
      { contractName: "Alarm Monitoring", serviceType: "MONITORING", days: 5, annualValue: 6000, status: "PENDING_RENEWAL" },
    ],
    tags: ["Education", "Multi-Site", "Priority Renewal"],
  },
  {
    name: "Harborview Hotel & Conference",
    accountType: "direct",
    rep: REPS[3],
    locations: [
      { name: "Harborview Downtown", addressLine1: "12 Testing Quay", city: "Crestview", state: "FL", postalCode: "32536" },
    ],
    contacts: [
      { name: "Alina Petrova", role: "CHIEF_ENGINEER", email: "a.petrova@harborviewhotel.example.com", phone: "850-555-0131", primary: true },
      { name: "Devon Marsh", role: "OPERATIONS_MANAGER", email: "d.marsh@harborviewhotel.example.com", phone: "850-555-0176" },
    ],
    deficiencies: [
      { title: "Guest-room smoke detector end-of-life", description: "Detectors past their ten-year replacement window on floors 4-6.", severity: "MAJOR", value: 9600, stage: "SENT", status: "QUOTED" },
      { title: "Standpipe hose valve leak", description: "Slow leak at the third-floor valve.", severity: "MINOR", value: 640, stage: "WON", status: "REPAIRED" },
    ],
    renewals: [
      { contractName: "Hospitality Life-Safety Program", serviceType: "INSPECTION_TESTING", days: 44, annualValue: 24800, status: "ACTIVE" },
    ],
    tags: ["VIP", "Net-30"],
  },
  {
    name: "Ironvale Manufacturing",
    accountType: "direct",
    rep: REPS[0],
    locations: [
      { name: "Ironvale Plant 1", addressLine1: "870 Placeholder Industrial Pkwy", city: "Columbus", state: "OH", postalCode: "43207" },
    ],
    contacts: [
      { name: "Bea Lindqvist", role: "SAFETY_OFFICER", email: "b.lindqvist@ironvalemfg.example.com", phone: "614-555-0159", primary: true },
      { name: "Hector Ramos", role: "MAINTENANCE_LEAD", email: "h.ramos@ironvalemfg.example.com", phone: "614-555-0113" },
    ],
    deficiencies: [
      { title: "Deluge system trip test overdue", description: "Annual trip test not performed on the paint line.", severity: "CRITICAL", value: 11200, stage: "QUOTED", status: "OPEN" },
      { title: "Foam concentrate past expiry", description: "Concentrate sampling failed the annual quality test.", severity: "MAJOR", value: 5800, stage: "LOST", status: "OPEN" },
      { title: "Hydrant flow test — private main", description: "Annual flow test outstanding.", severity: "MINOR", value: 1400, stage: "SCHEDULED", status: "QUOTED" },
    ],
    renewals: [
      { contractName: "Industrial Suppression Program", serviceType: "INSPECTION_TESTING", days: 120, annualValue: 61000, status: "ACTIVE" },
    ],
    tags: ["Industrial", "VIP"],
  },
  {
    name: "Juniper Hill Senior Living",
    accountType: "direct",
    rep: REPS[1],
    locations: [
      { name: "Juniper Hill Residence", addressLine1: "215 Sample Grove Ln", city: "Madison", state: "WI", postalCode: "53711" },
    ],
    contacts: [
      { name: "Marisol Vega", role: "FACILITIES_DIRECTOR", email: "m.vega@juniperhillsl.example.com", phone: "608-555-0182", primary: true },
      { name: "Arthur Kane", role: "SAFETY_OFFICER", email: "a.kane@juniperhillsl.example.com", phone: "608-555-0104" },
    ],
    deficiencies: [
      { title: "Sprinkler heads painted over — corridor B", description: "Fourteen heads painted during a refresh; replacement required.", severity: "MAJOR", value: 3900, stage: "SENT", status: "QUOTED" },
      { title: "Annual extinguisher and e-light service", description: "Combined annual service across the facility.", severity: "MINOR", value: 1980, stage: "WON", status: "REPAIRED" },
    ],
    renewals: [
      { contractName: "Life-Safety Inspection Program", serviceType: "INSPECTION_TESTING", days: 55, annualValue: 21500, status: "ACTIVE" },
      { contractName: "Alarm Monitoring", serviceType: "MONITORING", days: 3, annualValue: 6000, status: "PENDING_RENEWAL" },
    ],
    tags: ["Healthcare", "Priority Renewal"],
  },
];

// Activity templates cycled across accounts for a lived-in timeline.
const ACTIVITY_TEMPLATES: Array<{ type: string; subject: string | null; body: string; daysAgo: number }> = [
  { type: "CALL", subject: "Intro call", body: "Discussed upcoming annual inspection scope and access requirements.", daysAgo: 34 },
  { type: "EMAIL", subject: "Sent proposal", body: "Emailed the inspection proposal and W-9; awaiting PO.", daysAgo: 21 },
  { type: "MEETING", subject: "Walkthrough", body: "On-site walkthrough with facilities team; documented deficiencies with photos.", daysAgo: 14 },
  { type: "NOTE", subject: null, body: "Client prefers scheduling work after 5pm to avoid tenant disruption.", daysAgo: 9 },
  { type: "CALL", subject: "Follow-up", body: "Left voicemail regarding open quote; will retry Thursday.", daysAgo: 4 },
  { type: "EMAIL", subject: "Scheduling", body: "Coordinated crew arrival window and badge access with security.", daysAgo: 2 },
];

const TASK_TEMPLATES: Array<{ title: string; daysDue: number; done: boolean }> = [
  { title: "Send updated quote with net-30 terms", daysDue: -3, done: false },
  { title: "Confirm site access for inspection crew", daysDue: 2, done: false },
  { title: "Follow up on signed proposal", daysDue: 5, done: false },
  { title: "Email inspection report to client", daysDue: -10, done: true },
  { title: "Schedule kickoff with operations", daysDue: 9, done: false },
];

const INSPECTORS = ["J. Alvarez", "K. Sorensen", "R. Whitfield"];

async function clean(): Promise<number> {
  // Cascades from the account remove locations/contacts/opportunities/
  // deficiencies/inspections/renewals/activities/tasks/attachments tied to it.
  // Only SEED_MARK rows are matched, so hand-entered records are untouched.
  const demoAccounts = await prisma.crmAccount.findMany({
    where: { createdBy: SEED_MARK },
    select: { id: true },
  });
  if (demoAccounts.length > 0) {
    await prisma.crmAccount.deleteMany({
      where: { id: { in: demoAccounts.map((a) => a.id) } },
    });
  }
  // Demo tags (entity-tags cascade with the tag).
  await prisma.crmTag.deleteMany({ where: { name: { in: TAGS.map((t) => t.name) } } });
  return demoAccounts.length;
}

async function seed() {
  const removed = await clean();
  if (removed > 0) console.log(`Removed ${removed} prior demo account(s) before reseeding.`);

  // Tags up front so entity-tags can reference them.
  const tagIdByName = new Map<string, string>();
  for (const tag of TAGS) {
    const row = await prisma.crmTag.create({ data: { name: tag.name, color: tag.color } });
    tagIdByName.set(tag.name, row.id);
  }

  let contactCount = 0;
  let oppCount = 0;
  let renewalCount = 0;
  let activityCount = 0;
  let taskCount = 0;
  let entityTagCount = 0;

  for (let a = 0; a < ACCOUNTS.length; a++) {
    const spec = ACCOUNTS[a];

    const account = await prisma.crmAccount.create({
      data: {
        name: spec.name,
        accountType: spec.accountType,
        salesRepEmail: spec.rep,
        notes: `${spec.accountType} account — seeded demo data.`,
        createdBy: SEED_MARK,
        updatedBy: SEED_MARK,
        locations: {
          create: spec.locations.map((loc, i) => ({
            name: loc.name,
            addressLine1: loc.addressLine1,
            city: loc.city,
            state: loc.state,
            postalCode: loc.postalCode,
            isPrimary: i === 0,
          })),
        },
      },
      include: { locations: true },
    });
    const primaryLocation = account.locations[0];

    for (const contact of spec.contacts) {
      await prisma.crmContact.create({
        data: {
          accountId: account.id,
          locationId: primaryLocation?.id ?? null,
          name: contact.name,
          role: contact.role,
          email: contact.email,
          phone: contact.phone,
          isPrimary: contact.primary ?? false,
          notes: null,
        } as never,
      });
      contactCount++;
    }

    // One inspection carrying this account's deficiencies + opportunities.
    const inspection = await prisma.crmInspection.create({
      data: {
        accountId: account.id,
        locationId: primaryLocation?.id ?? null,
        inspectionType: "ANNUAL",
        status: "COMPLETED",
        inspectedAt: daysFromNow(-40 - a),
        inspectorName: pick(INSPECTORS, a),
        notes: "Annual inspection — deficiencies documented below.",
        createdBy: SEED_MARK,
      } as never,
    });

    for (let d = 0; d < spec.deficiencies.length; d++) {
      const def = spec.deficiencies[d];
      const deficiency = await prisma.crmDeficiency.create({
        data: {
          inspectionId: inspection.id,
          accountId: account.id,
          locationId: primaryLocation?.id ?? null,
          title: def.title,
          description: def.description,
          severity: def.severity,
          status: def.status,
          estimatedValue: def.value,
          salesRepEmail: spec.rep,
          createdBy: SEED_MARK,
        } as never,
      });

      const isWon = def.stage === "WON";
      const isLost = def.stage === "LOST";
      const opportunity = await prisma.crmOpportunity.create({
        data: {
          accountId: account.id,
          locationId: primaryLocation?.id ?? null,
          deficiencyId: deficiency.id,
          title: def.title,
          opportunityType: "SERVICE_DEFICIENCY",
          stage: def.stage,
          value: def.value,
          salesRepEmail: spec.rep,
          notes: null,
          createdBy: SEED_MARK,
          updatedBy: SEED_MARK,
          wonAt: isWon ? daysFromNow(-7 - d) : null,
          lostAt: isLost ? daysFromNow(-5 - d) : null,
          lostReason: isLost ? "Client deferred to next fiscal year." : null,
          scheduledAt: def.stage === "SCHEDULED" ? daysFromNow(5 + d) : null,
        } as never,
      });
      oppCount++;

      // A stage-change activity on the opportunity, for timeline realism.
      await prisma.crmActivity.create({
        data: {
          entityType: "OPPORTUNITY",
          entityId: opportunity.id,
          accountId: account.id,
          activityType: "STAGE_CHANGE",
          subject: `Stage: Deficiency Identified → ${def.stage.replace("_", " ")}`,
          body: null,
          occurredAt: daysFromNow(-8 - d),
          createdBy: spec.rep,
        } as never,
      });
      activityCount++;
    }

    for (const renewal of spec.renewals) {
      await prisma.crmRenewal.create({
        data: {
          accountId: account.id,
          locationId: primaryLocation?.id ?? null,
          contractName: renewal.contractName,
          serviceType: renewal.serviceType,
          renewalDate: daysFromNow(renewal.days),
          annualValue: renewal.annualValue,
          status: renewal.status,
          salesRepEmail: spec.rep,
          createdBy: SEED_MARK,
        } as never,
      });
      renewalCount++;
    }

    // Account-level activity timeline (rotate templates + offset per account).
    const nActs = 3 + (a % 3); // 3-5 activities per account
    for (let i = 0; i < nActs; i++) {
      const t = pick(ACTIVITY_TEMPLATES, a + i);
      await prisma.crmActivity.create({
        data: {
          entityType: "ACCOUNT",
          entityId: account.id,
          accountId: account.id,
          activityType: t.type,
          subject: t.subject,
          body: t.body,
          occurredAt: daysFromNow(-t.daysAgo - a),
          createdBy: spec.rep,
        } as never,
      });
      activityCount++;
    }

    // Tasks (mix of open / overdue / done), assigned to the account's rep.
    const nTasks = 2 + (a % 2); // 2-3 tasks
    for (let i = 0; i < nTasks; i++) {
      const t = pick(TASK_TEMPLATES, a + i);
      await prisma.crmTask.create({
        data: {
          title: t.title,
          status: t.done ? "DONE" : "OPEN",
          dueDate: daysFromNow(t.daysDue),
          assigneeEmail: spec.rep,
          entityType: "ACCOUNT",
          entityId: account.id,
          accountId: account.id,
          completedAt: t.done ? daysFromNow(-2) : null,
          createdBy: SEED_MARK,
        } as never,
      });
      taskCount++;
    }

    for (const tagName of spec.tags) {
      const tagId = tagIdByName.get(tagName);
      if (!tagId) continue;
      await prisma.crmEntityTag.create({
        data: { tagId, entityType: "ACCOUNT", entityId: account.id },
      });
      entityTagCount++;
    }

    console.log(`  ✓ ${spec.name}`);
  }

  console.log("\nDemo CRM data seeded:");
  console.log(`  accounts:      ${ACCOUNTS.length}`);
  console.log(`  contacts:      ${contactCount}`);
  console.log(`  opportunities: ${oppCount} (across all ${OPP_STAGES.length} stages)`);
  console.log(`  renewals:      ${renewalCount}`);
  console.log(`  activities:    ${activityCount}`);
  console.log(`  tasks:         ${taskCount}`);
  console.log(`  tags:          ${TAGS.length} (${entityTagCount} assignments)`);
  console.log(`  sales reps:    ${REPS.length}`);
}

async function main() {
  if (process.env.CRM_DEMO_SEED_CONFIRM !== "I_UNDERSTAND") {
    throw new Error(
      "Refusing to run: set CRM_DEMO_SEED_CONFIRM=I_UNDERSTAND (this writes to the database in DATABASE_URL)",
    );
  }

  const cleanOnly = process.argv.includes("--clean");
  if (cleanOnly) {
    const removed = await clean();
    console.log(`Removed ${removed} demo account(s) and demo tags. CRM demo data cleared.`);
  } else {
    await seed();
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
