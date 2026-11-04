/** Key Personnel & Emergency Contacts — empty template per project. */

export type ContactPerson = {
  name: string;
  position: string;
  number: string;
};

export type ContactGroup = {
  name: string;
  red?: boolean;
  rows: ContactPerson[];
};

export type ProjectContacts = {
  id: string;
  title: string;
  client: string;
  placeholder?: boolean;
  groups: ContactGroup[];
  hospitals: Array<{ name: string; number: string }>;
};

export const CONTACT_PROJECTS = [
  "Jafurah",
  "MGS",
  "Yanbu",
  "Ras Tanura",
] as const;

export type ContactProjectId = (typeof CONTACT_PROJECTS)[number];

export const ARAMCO_EMERGENCY = {
  landline: "911",
  mobile: "013-378-0911, 013-379-0911",
  areas: [
    { label: "Tanajib", number: "013-378-0911" },
    { label: "Manifa", number: "013-379-0911" },
    { label: "Khursaniyah", number: "013-679-0911" },
  ],
  gov: [
    { label: "Traffic Accident", number: "993" },
    { label: "Road Safety", number: "996" },
    { label: "Ambulance", number: "997" },
    { label: "Fire", number: "998" },
    { label: "Police", number: "999" },
    { label: "Tel. Info (Saudi Aramco)", number: "905" },
    { label: "Tel. Info", number: "906" },
  ],
  steps: [
    "Stop work.",
    "Remain calm.",
    "Follow local plans and instructions.",
    "Proceed safely to the nearest assembly point.",
    'Remain at the assembly area until the "ALL CLEAR" is sounded.',
  ],
  operator: [
    'Say "This is an emergency".',
    "Describe the incident location.",
    "Describe the incident.",
    "Report injury, if any.",
    "Give your name and badge number.",
    "Repeat the above information.",
  ],
  aramcoNote: "To report an emergency in Aramco: call 911, or 013-576-7911 from a mobile.",
};

function emptyRows(positions: string[]): ContactPerson[] {
  return positions.map((position) => ({
    name: "[Name]",
    position,
    number: "[Number]",
  }));
}

/** Shared empty layout used for every project until Admin fills names/numbers. */
function emptyProjectPack(id: ContactProjectId): ProjectContacts {
  return {
    id,
    title: `${id} Project – Key Personnel & Emergency Contacts`,
    client: "Saudi Aramco",
    placeholder: false,
    groups: [
      {
        name: "Saudi Aramco Client Team",
        rows: emptyRows([
          "Company Representative",
          "Project Engineer",
          "HSE Division Lead",
          "Safety Advisor",
        ]),
      },
      {
        name: "Bin Quraya 24 Hours Emergency Contact Number",
        red: true,
        rows: emptyRows([
          "Project Manager",
          "Construction Manager",
          "HSE Manager",
          "HSE Supervisor",
          "Project Medic",
          "Ambulance Driver",
        ]),
      },
      {
        name: "SCC Team",
        rows: emptyRows([
          "SCC Supervisor",
          "SCC Operator (Day)",
          "SCC Operator (Night)",
        ]),
      },
      {
        name: "Emergency Response Team (ERT)",
        rows: emptyRows(["ERT Leader", "First Aider", "Fire Watch Lead"]),
      },
    ],
    hospitals: [{ name: "[Nearest hospital]", number: "[Number]" }],
  };
}

export const CONTACTS_BY_PROJECT: Record<ContactProjectId, ProjectContacts> = {
  Jafurah: emptyProjectPack("Jafurah"),
  MGS: emptyProjectPack("MGS"),
  Yanbu: emptyProjectPack("Yanbu"),
  "Ras Tanura": emptyProjectPack("Ras Tanura"),
};
