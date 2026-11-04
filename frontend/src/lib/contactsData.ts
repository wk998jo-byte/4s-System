/** V1 Key Personnel & Emergency Contacts seed (Dhahran sample). */

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
  "Dhahran",
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

function people(rows: Array<[string, string, string]>): ContactPerson[] {
  return rows.map(([name, position, number]) => ({ name, position, number }));
}

export const CONTACTS_BY_PROJECT: Record<ContactProjectId, ProjectContacts> = {
  Dhahran: {
    id: "Dhahran",
    title: "Dhahran – Key Personnel & 24 Hours Emergency Contacts (format from the Zuluf sheet)",
    client: "Dhahran",
    groups: [
      {
        name: "Saudi Aramco SAPMT",
        rows: people([
          ["Hamad Balhareth", "Company Representative", "0556000394"],
          ["Mustafa J. Muailo", "SAPMT Project Engineer", "0537098628"],
          ["Ali F. Khan", "SAPMT Project Engineer", "0539300151"],
          ["Bader Dayhani", "SAPMT Project Engineer", "0500705650"],
          ["Junrey G. Navarro", "SAPMT HSE Div. Lead", "0535204589"],
          ["Sulaiman Aloqaily", "SAPMT Safety Advisor", "0501822828"],
          ["Abdulaziz Alserwan", "SAPMT Safety Advisor", "0558652670"],
          ["Qasem Alajam", "SAPMT Safety Advisor", "0569955114"],
          ["Khalid M Shuqayfah", "SAPMT Safety Advisor", "0536287137"],
        ]),
      },
      {
        name: "Bin Quraya 24 Hours Emergency Contact Number",
        red: true,
        rows: people([
          ["Claudio Catroppa", "Contractor Representative", "0550933266"],
          ["Mohammed Osman", "Project Manager", "0569268702"],
          ["Faheem Shahzad", "Construction Manager", "0549529097"],
          ["Rene Oliveria", "HSE Manager", "0599005288"],
          ["Mariano Jayme Jr.", "Sr. HSE Supervisor", "0542598087"],
          ["Ahamad Salim", "HSE Supervisor", "0510533406"],
          ["Shoaib Ijaz", "Environmental Coordinator", "0576697517"],
          ["Syed Ibrahim", "Camp Boss", "0543878827"],
          ["Byju Thomas", "Project Medic (Male Nurse)", "0537255731"],
          ["Nasir Abdulwahab", "Ambulance Driver", "0501408784"],
          ["Edwin Galano", "PWAS Coordinator", "0572110143"],
          ["Abdhulla", "Aramco Issuer", "0557619616"],
        ]),
      },
      {
        name: "First Aiders @ Site",
        rows: people([
          ["Jonathan Maranan", "First Aider Team Leader", "0568188934"],
          ["Wencis Bahunsua", "First Aider", "0561058092"],
          ["Allan Flor", "First Aider", "0541035238"],
          ["Farhan Murtaza", "First Aider", "0592725142"],
          ["Shakeel Ahmed Lal", "First Aider", "0594832171"],
        ]),
      },
    ],
    hospitals: [
      { name: "Al Nairiah General Hospital", number: "013-373-1000" },
      { name: "Health and Safety Medical Complex", number: "013-373-0033" },
      { name: "Maiden Hospital", number: "013-373-0221" },
    ],
  },
  Jafurah: {
    id: "Jafurah",
    title: "Jafurah Project – Key Personnel & Emergency Contacts",
    client: "Saudi Aramco",
    placeholder: true,
    groups: [],
    hospitals: [],
  },
  MGS: {
    id: "MGS",
    title: "MGS Project – Key Personnel & Emergency Contacts",
    client: "Saudi Aramco",
    placeholder: true,
    groups: [],
    hospitals: [],
  },
  Yanbu: {
    id: "Yanbu",
    title: "Yanbu Project – Key Personnel & Emergency Contacts",
    client: "Saudi Aramco",
    placeholder: true,
    groups: [],
    hospitals: [],
  },
  "Ras Tanura": {
    id: "Ras Tanura",
    title: "Ras Tanura Project – Key Personnel & Emergency Contacts",
    client: "Saudi Aramco",
    placeholder: true,
    groups: [],
    hospitals: [],
  },
};
