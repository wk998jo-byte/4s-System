/** Key Personnel & Emergency Contacts — per-project packs. */

export type ContactPerson = {
  name: string;
  position: string;
  number: string;
  email?: string;
};

export type ContactGroup = {
  name: string;
  red?: boolean;
  rows: ContactPerson[];
};

export type EmergencyArea = { label: string; number: string };

export type ProjectContacts = {
  id: string;
  /** Small line above the main title (e.g. division). */
  division?: string;
  title: string;
  contract?: string;
  client: string;
  /** Bin Quraya 24/7 hotline — editable via Edit contacts. */
  hotline: string;
  placeholder?: boolean;
  groups: ContactGroup[];
  hospitals: Array<{ name: string; number: string }>;
  emergency?: {
    landline: string;
    mobile: string;
    areas: EmergencyArea[];
  };
};

export const CONTACT_PROJECTS = [
  "Jafurah",
  "MGS",
  "Yanbu",
  "Ras Tanura",
  "Dhahran",
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

function person(name: string, position: string, number: string, email = ""): ContactPerson {
  return { name, position, number, email };
}

function emptyRows(positions: string[]): ContactPerson[] {
  return positions.map((position) => ({
    name: "[Name]",
    position,
    number: "[Number]",
    email: "",
  }));
}

/** Shared empty layout used for projects not yet filled. */
function emptyProjectPack(id: ContactProjectId): ProjectContacts {
  const groups: ContactGroup[] = [];
  // Dhahran omits Saudi Aramco PMT and the shared emergency/hospital blocks.
  if (id !== "Dhahran") {
    groups.push({
      name: "Saudi Aramco PMT",
      rows: emptyRows([
        "SAPMT Lead Engineer",
        "SAPMT Project Engineer",
        "Field Compliance Coordinator",
      ]),
    });
  }
  groups.push(
    {
      name: "Bin Quraya",
      red: true,
      rows: emptyRows([
        "Project Manager",
        "Construction Manager",
        "HSE Manager",
      ]),
    },
    {
      name: "Safety Team",
      rows: emptyRows([
        "Safety Manager",
        "Safety Supervisor",
        "Project Medic",
      ]),
    },
    {
      name: "Logistics Team",
      rows: emptyRows(["Logistics Coordinator"]),
    },
    {
      name: "SCC Team",
      rows: emptyRows(["SCC Operator"]),
    },
  );
  return {
    id,
    division: "",
    title: `${id} Project – Key Personnel & Emergency Contacts`,
    contract: "",
    client: "Saudi Aramco",
    hotline: "",
    placeholder: true,
    groups,
    hospitals: id === "Dhahran" ? [] : [{ name: "[Nearest hospital]", number: "[Number]" }],
  };
}

const JAFURAH_PACK: ProjectContacts = {
  id: "Jafurah",
  division: "Riyas Pipeline Project Division",
  title: "Jafurah Downstream Pipeline Project Division (JFDP)",
  contract: "Contract No.: 6601000358 / BI-10-14245",
  client: "Saudi Aramco",
  hotline: "",
  groups: [
    {
      name: "Saudi Aramco PMT",
      rows: [
        person("Jason Michael", "Division Safety Lead - Riyas", "0505903583"),
        person("Hassan Ismailu", "Lead Project Engineer - Riyas", "0532862207"),
        person("Abdullah Hussain", "Project Engineer - Riyas", "0597409025"),
        person("Awad Al Harbi", "SAPMT PCC - Riyas", "0531249446"),
        person("Alfredo Mandoza", "SAPMT PCC - Riyas", "0503596149"),
        person(
          "Dhahran Shift Manager",
          "Saudi Aramco Operations, Dhahran Corridor - Jafurah South",
          "0506837304",
        ),
        person("Ibrahim M Deran", "SA PPD Project Manager - Jafurah South", "0547744565"),
        person("Khalid Algharbi", "SA PPD Supervisor - Jafurah South", "0538041260"),
        person(
          "Saeed Alshurayet",
          "SAPMT Field Compliance Coordinator - Jafurah South",
          "0504917045",
        ),
        person(
          "Tarlan Hasanov",
          "SAPMT Field Compliance Coordinator - Jafurah South",
          "0502101715",
        ),
        person(
          "Carlos Cayabyab",
          "SAPMT Field Compliance Coordinator - Jafurah South",
          "0554754784",
        ),
      ],
    },
    {
      name: "Bin Quraya",
      red: true,
      rows: [
        person("Shaukat Ali", "Senior Project Manager", "0551350432 / 0555072936"),
        person("Mohammed Mousa", "Sr. Construction Manager - Riyas", "0532752113"),
        person(
          "Omer Suliman",
          "Senior Construction Manager - Jafurah South",
          "0500753616",
        ),
        person(
          "Muhammad Sharafuddin",
          "Construction Manager - Jafurah South",
          "0580767697",
        ),
        person("Ibrahim Quraishi", "Construction Manager - Jafurah South", "0534505305"),
        person(
          "Otthmane Taofiq",
          "Construction Superintendent - Jafurah South",
          "0583316607",
        ),
      ],
    },
    {
      name: "Safety Team",
      rows: [
        person("Usman Iqbal", "Safety Manager", "0557875932"),
        person(
          "Rolando Manio",
          "Safety Coordinator - ERT Leader - Riyas",
          "0565636416 / 0541828096",
        ),
        person("Francisco Casem", "Safety Coordinator - Jafurah South", "0572393583"),
        person(
          "Johnlery Ronda Diaz",
          "Safety Supervisor - Search & Rescue Coordinator - Riyas",
          "0553539049 / 0533539049",
        ),
        person(
          "Rhoy (Rolando) Oliveria",
          "Safety Supervisor - Search & Rescue Coordinator - Riyas",
          "0561015767",
        ),
        person(
          "Syed Mateen Hussaini",
          "Safety Supervisor - First Aider - Riyas",
          "0596856632",
        ),
        person("Bengel Albana Venus", "Safety Supervisor - Jafurah South", "0542916843"),
        person("Malik Junaid", "Safety Supervisor - Jafurah South", "0591338824"),
        person("Ahmad Hassan", "Environmental Coordinator - Riyas", "0552182584"),
        person("Selvam Kamaraj", "Male Nurse - Riyas", "0548079938"),
        person("Md. Shakil Hossain", "Ambulance Driver (24 hours) - Riyas", "0555347143"),
        person("Vishnu Sukumaran", "Male Nurse - Jafurah South", "0504788178"),
        person("Salim Abdul Rajak", "Male Nurse - Jafurah South", "0536317344"),
        person("Sobuj Mia", "Ambulance Driver - Jafurah South", "0572688840"),
        person("Sheraz", "Ambulance Driver - Jafurah South", "0534698030"),
        person("Shahzada Omer", "First Aider - Riyas ERT", "0557394280"),
        person("Joel David", "First Aider - Riyas ERT", "0544122695"),
        person("Zeeshan Mushood", "First Aider - Riyas ERT", "0554828142"),
        person("Juniper Premacio", "First Aider - Riyas ERT", "0537786852"),
        person("Reneboy Bagsic", "First Aider - Riyas ERT", "0551449573"),
        person("Abdul Razzaq", "First Aider - Riyas ERT", "0573259836"),
        person("Motilal Prajapati", "First Aider - Riyas ERT", "0571850958"),
        person("Umair Shabbir", "First Aider - Riyas ERT", "0581620521"),
        person("Ofori Ebenezer", "First Aider - Riyas ERT", "0594076285"),
        person("Danish Imam", "First Aider - Riyas ERT", "0530510820"),
      ],
    },
    {
      name: "Logistics Team",
      rows: [
        person("Muhammad Ali", "Transport Coordinator - Riyas", "0583361450"),
        person(
          "Haidar Mohammed A Almuhaysin",
          "Traffic Coordinator - Jafurah South",
          "0544944982",
        ),
        person("Rajesh", "Fire Water Truck - Riyas", "0543263848"),
        person("Laxman Tamang", "Fire Water Truck - Riyas", "0573097579"),
      ],
    },
    {
      name: "SCC Team",
      rows: [
        person("Mohammed Jafar AlMubaireek", "SCC Communication - Riyas", "0543657847"),
        person("Mohd Afzaal", "SCC Operator", ""),
        person("Muhammad Nawaz", "SCC Operator", ""),
      ],
    },
  ],
  emergency: {
    landline: "911",
    mobile: "013-673-0911 (Riyas), 013-679-0911 (Jafurah South)",
    areas: [
      { label: "Northern Area (Ras Tanura)", number: "013-679-0911" },
      { label: "Southern Area", number: "013-572-0911" },
      { label: "Central Area", number: "013-872-0911" },
      { label: "Riyas NGL", number: "013-673-0911" },
      { label: "Juaymah", number: "013-677-0911" },
    ],
  },
  hospitals: [
    {
      name: "Riyas - Jubail General Hospital (animal bites, road accidents, H2S)",
      number: "013-362-2233",
    },
    { name: "Riyas - Royal Commission Hospital", number: "013-346-4090" },
    { name: "Riyas - KIMS Hospital Jubail", number: "053-264-0033" },
    { name: "Riyas - Ras Tanura General Hospital", number: "013-667-4444" },
    { name: "Jafurah South - King Fahad Hospital (Hofuf)", number: "013-535-4444" },
    { name: "Jafurah South - Al-Hasa Hospital", number: "013-538-4666" },
    { name: "Jafurah South - General Hospital Abqaiq", number: "013-566-2222" },
    { name: "Jafurah South - Al-Dosary Hospital (Al-Khobar)", number: "013-801-1910" },
  ],
};

const MGS_PACK: ProjectContacts = {
  id: "MGS",
  division: "Master Gas Central Region Pipeline Division",
  title: "Master Gas System Expansion Phase III",
  contract: "Contract No.: 6601019403 / BI-49-14044",
  client: "Saudi Aramco",
  hotline: "0539513330",
  groups: [
    {
      name: "Saudi Aramco PMT",
      rows: [
        person("Ahmed Alhelal", "SAPMT Lead Engineer", "0553684376"),
        person(
          "Saif Al Onazi",
          "SAPMT Safety Advisor / Field Compliance Coordinator",
          "0551468652",
        ),
        person("Rexand Carriaga", "SAPMT Engineer", "0541835757"),
      ],
    },
    {
      name: "Bin Quraya",
      red: true,
      rows: [
        person(
          "Zaid Nawwaf AlEitan",
          "Sr. Project Manager - Incident Commander",
          "0582996371",
        ),
        person(
          "Faheem Shehzad",
          "Construction Manager - Field Incident Commander",
          "0549529097",
        ),
        person("Syed Saddam Hussain", "Construction Manager", "0551388702"),
        person("Imran Zafar", "Admin", "0541316950"),
        person("Fahad Javed", "DC / Time Keeper", "0537068357"),
      ],
    },
    {
      name: "Safety Team",
      rows: [
        person("Syed Adnan Haider", "HSE Manager", "0508412676"),
        person("Bilal Khan", "Asst. Safety Manager", "0532981345"),
        person("Hammad Hanif", "Safety Supervisor", "0505341681"),
        person("Benny Joseph", "Safety Supervisor", "0539811156"),
        person("Teresito Garcia", "Safety Supervisor", "0558037279"),
        person("Hafiz Zaid", "Safety Supervisor", "0556635397"),
        person("Ibrahim Nawfal AK", "SMS Coordinator", "0509770531"),
        person("Haseeb Khizar", "Male Nurse (BQ Clinic)", "0575337646"),
        person("Ahmad Elbadry", "Male Nurse", "0552635109"),
        person(
          "Mohamed Saad Aboelenen Aied",
          "Male Nurse (Aramco Clinic)",
          "0583350123",
        ),
        person("M. Junaid", "Male Nurse", "0547724812"),
        person("Muhammad Umar Khaja", "Male Nurse", "0539625718"),
        person("Jamrad Khan", "Ambulance Driver (Aramco)", "0580732092"),
        person("Ahmad Aliyan", "Ambulance Driver", "0560983472"),
        person("Moses Narh", "Ambulance Driver", "0541986321"),
        person("Taha Garhei Ali Ibrahim", "Ambulance Driver", "0539294286"),
        person("Noor Zaman", "First Aider", "0556345217"),
        person("Muhammad Asghar Ali", "First Aider", "0539713678"),
      ],
    },
    {
      name: "Logistics Team",
      rows: [
        person(
          "Mohammad Amair Sohel",
          "Logistic Coordinator / Maintenance Engineer",
          "0530511658",
        ),
        person("Taalam Khan", "Equipment Coordinator", "0549867006"),
        person("Ansar Basha", "Camp Boss", "0550456168"),
      ],
    },
    {
      name: "SCC Team",
      rows: [
        person("Altayeb Altayeb", "SCC Manager", "0542248998"),
        person("Tahani AlMohammed", "SCC Coordinator", "0564236994"),
        person("Hazem AlGrainees", "SCC Operator", "0550690033"),
        person("Mohammed AlAbdli", "IT & Network Engineering", "0559219080"),
      ],
    },
  ],
  emergency: {
    landline: "911",
    mobile: "013-574-0911",
    areas: [
      { label: "Riyadh", number: "011-285-0911" },
      { label: "Pump Station", number: "013-574-0911" },
    ],
  },
  hospitals: [
    {
      name: "Prince Mohammed bin Abdulaziz Hospital",
      number: "800 127 7000 / +966 11 261 6666",
    },
    { name: "Al Azhar Medical", number: "0580633106" },
    { name: "Rafa Medical Center", number: "920005405" },
  ],
};

const YANBU_PACK: ProjectContacts = {
  id: "Yanbu",
  division: "East West Pipeline Project Division",
  title: 'REPLACE 56" ABQAIQ-YANBU PIPELINE (AY-1L) SECTION 7',
  contract: "Contract No.: 6601019567 / BI-10-01575",
  client: "Saudi Aramco",
  hotline: "0564238728",
  groups: [
    {
      name: "Saudi Aramco PMT",
      rows: [
        person("Ahmad Lateef Daud", "SAPMT Lead Engineer", "0569007125"),
        person("Faris Asali", "SAPMT Project Engineer", "0531370487"),
        person("Muhammad Bilal", "SAPMT Sr. FCC", "0599359297"),
        person("Ahmed Bin Hajib", "SAPMT Sr. FCC", "0556511155"),
        person("Bayh Moaed A.", "SAPMT FCC", "0591033366"),
        person("Waleed Alsharif", "SAPMT FCC", "0505557111"),
        person("Syed Talha", "SAPMT Facility Coordinator - TCF 1", "0530164942"),
      ],
    },
    {
      name: "Bin Quraya",
      red: true,
      rows: [
        person("Mohammed Osman", "Project Manager", "0569268702"),
        person("Senthil Kumar", "Construction Manager", "0550953913"),
        person("Abdul Raheem", "Project Engineer", "0564786028"),
        person("Ahmed Abdelsattar", "Corporate Medical Service", "0556183435"),
        person("Baqer Alshorit", "Manager & Cybersecurity - IT", "0508397459"),
        person("Mohd Saleh", "Security Supervisor", "0583875243"),
      ],
    },
    {
      name: "Safety Team",
      rows: [
        person("Enjamamul Haque", "Safety Manager", "0504506322"),
        person("Gopakumar M", "Deputy Safety Manager", "0595939082"),
        person("Ahamad Salim", "Safety Supervisor", "0552460778"),
        person("Shakil Ahamad", "Safety Supervisor - KP 110 to 185", "0599673820"),
        person(
          "Muhammad Kashif Ghulam Nabi",
          "Safety Supervisor - KP -7 to 110",
          "0549746969",
        ),
        person("Sehzad Sarfaraz", "Environmental Coordinator", "0531976701"),
        person(
          "Mohammad Danish",
          "Project Medic (Male Nurse) - TCF 1 - KP 110 to 185",
          "0561249291",
        ),
        person(
          "Sher Khan",
          "Ambulance Driver - TCF 1 - KP 110 to 185",
          "0581372672",
        ),
        person(
          "Nyzam Salim",
          "Project Medic (Male Nurse) - TCF 2 - KP 59 to 110",
          "0550957950",
        ),
        person(
          "Naseer Khan",
          "Ambulance Driver - TCF 2 - KP 59 to 110",
          "0552764474",
        ),
        person(
          "Muhammad Rabee",
          "Project Medic (Male Nurse) - TCF 3 - KP -7 to 59",
          "0547818528",
        ),
        person(
          "Ajmal Khan",
          "Ambulance Driver - TCF 3 - KP -7 to 59",
          "0582510865",
        ),
        person("Aftab Ahmed Khan Ali Khan", "Safety Officer", "0561455866"),
        person("Jitendra Yadav", "Safety Officer", "0573351377"),
        person("Brayner Allen", "Safety Officer", "0535428327"),
        person("Khan Gulam Sarwar", "Safety Officer", "0576283029"),
        person("Mohammed Sohailuddin", "Safety Officer", "0574585016"),
        person("Abid Ali", "Safety Officer", "0580152894"),
        person("Abdul Basit", "Safety Officer", "0553068293"),
        person("Shamaz Sheraz", "Safety Officer", "0534682327"),
        person("Jafar Iqbal", "Safety Officer", "0536714793"),
        person("Muqaddus Yasin", "Safety Officer", "0540580358"),
        person("Haider Usman", "Safety Officer", "0572886567"),
        person("Rizwan Mohd Ilyas", "Fire Warden", "0539135387"),
        person("MD Tahzzot Hosain", "Fire Warden", "0560383869"),
        person("Kamlesh Kumar", "Fire Warden", "0571512492"),
        person("Sundar Pasman", "Fire Warden", "0570163579"),
        person("Santosh Kumar", "Fire Warden", "0573090087"),
        person("MD Khalid", "Fire Warden", "0572149916"),
        person("Mohd Farhaz", "Fire Warden", "0571453828"),
      ],
    },
    {
      name: "Logistics Team",
      rows: [
        person(
          "Rajkumar Singh",
          "Equipment / Logistics Supervisor",
          "0552468634",
        ),
        person("Ratheesh Pillai", "Workshop Supervisor", "0538209876"),
        person("Shakir Hussain", "Camp Boss - TCF 1", "0598512638"),
        person("M. Jahanzaid", "Camp Boss - TCF 2", "0558732167"),
        person("Mohamed Ekramuddin", "Camp Boss - TCF 3", "0510782025"),
        person("Roberto A. Reyas", "Electrician", "0557142154"),
        person("Raj Pandit", "Plumber", "0571709422"),
      ],
    },
    {
      name: "SCC Team",
      rows: [
        person(
          "Osama Almassar",
          "Safety Command Center Operator",
          "0559365448",
        ),
      ],
    },
  ],
  emergency: {
    landline: "911",
    mobile: "013-378-0911, 013-379-0911",
    areas: [
      { label: "Jeddah", number: "012-427-0911" },
      { label: "Yanbu", number: "014-397-0911" },
      { label: "Madinah", number: "014-397-0911" },
    ],
  },
  hospitals: [
    { name: "Al Madinah Hospital", number: "014-813-6001" },
    { name: "Safa Al Madinah Hospital", number: "014-844-0000" },
    { name: "Madinah National Hospital", number: "014-844-4444" },
    { name: "Saudi German Hospital Madinah", number: "920-007-997" },
    { name: "Badr General Hospital", number: "014-321-852" },
    { name: "Al Yutmah Medical Service", number: "014-854-3855" },
  ],
};

const RAS_TANURA_PACK: ProjectContacts = {
  id: "Ras Tanura",
  division: "Northern Area Pipeline Project Division",
  title: "Increase AM Crude Supply to RT Terminal Project",
  contract: "Contract No.: 6601015410 / BI-10-14609",
  client: "Saudi Aramco",
  hotline: "0509001883",
  groups: [
    {
      name: "Saudi Aramco PMT",
      rows: [
        person("Maythem Al Sadah", "Supervisor Project Engineer", "0538605428"),
        person("Sulbaran Parra, Jose L", "SAPMT Project Engineer", "0555283319"),
        person("Alexender Ponraj", "Field Compliance Coordinator", "0536063255"),
        person("Vijumon", "Field Compliance Coordinator", "0597808854"),
      ],
    },
    {
      name: "Bin Quraya",
      red: true,
      rows: [
        person("Ahmed Hemdan", "Project Manager", "0590723617"),
        person("Ali Alali", "Construction Manager", "0565843543"),
        person("Danilo Datu", "Construction Manager", "0596008480"),
        person("Hassan Noufal", "Construction Manager", "0599090850"),
        person("Erasad Ahmed", "Mechanical Engineer", "0581405732"),
      ],
    },
    {
      name: "Safety Team",
      rows: [
        person("Sirajul Islam", "HSE Manager", "0509001883"),
        person("Rolando", "HSE Trainer", "0561323190"),
        person(
          "Zia Ur Rahman",
          "Environmental Coordinator",
          "0580948002 / 0580948022",
        ),
        person("Geresh Babu", "SMS Coordinator", "0508163213"),
        person("Zawed Akhar", "HE Coordinator", "0510356482"),
        person("Raj Kishor Paswan", "PWAS Coordinator", "0575206945"),
        person("Wadud Khan", "Sr. HSE Supervisor", "0532892914"),
        person("Ahmad Ali", "HSE Supervisor", "0571808287"),
        person("Mahdi Hassan", "HSE Supervisor", "0566424122"),
        person("Thomas Kuriakose", "Male Nurse", "0571483254"),
        person("Mansour Meshmesh", "Male Nurse", "0558465907"),
        person("Mohammed Sumon", "Ambulance Driver", "0537016350"),
        person("Ahmed Shaar", "Ambulance Driver", "0554675521"),
        person(
          "Faisal J. Al Mansor",
          "HSE Officer (24 hours) - Camp / Office",
          "0581705071",
        ),
        person("Francis Torres", "HSE Officer-1 - Site", "0538983160"),
        person("Ahmed Yasir Abu R.", "HSE Officer-2 - Site", "0547836740"),
        person("Syed Ahmed Azath", "HSE Officer-3 - Site", "0500806559"),
        person("Rafiqul Islam", "HSE Officer-4 - Site", "0590398531"),
        person("Mustafa Khan", "HSE Officer-5 - Site", "0509752933"),
        person("Ibrahim Al Mashama", "HSE Officer-6 - Site", "0536643917"),
        person("Noor Mohammed", "HSE Officer-7 - Site", "0547562330"),
        person("Muhannad Alzahrani", "HSE Officer-8 - Site", "0545961943"),
        person("Yahya Ali Mirza", "HSE Officer-9 - Site", "0556299860"),
        person("Ranjith Dasan", "HSE Officer-10 - Site", "0510453387"),
        person("Hassan Almadan", "HSE Officer-11 - Site", "0563544320"),
        person("Ali Maidan", "HSE Officer-12 - Site", "054532448"),
        person("Mohammed Khaleel", "HSE Officer-13 - Site", "0564203417"),
        person("Abdul Hanan", "HSE Officer-14 - Site", "0572494652"),
        person("Hassan Raja Khan", "HSE Officer-15 - Site", "0501963500"),
        person("Mohammad Imran", "HSE Officer-16 - Site", "0537665673"),
        person("Mhad Benson", "HSE Officer-17 - Site", "0551761890"),
        person("Baqer Al Marhoon", "HSE Officer-18 - Site", "0541848119"),
        person("Naif Alomar", "HSE Officer-19 - Site", "0533501958"),
        person("Abdullah Albati", "HSE Officer-20 - Site", "0564320435"),
        person("Hussain Alzori", "HSE Officer-21 - Site", "0569642866"),
        person("Yassir Hussein (Scorpion)", "HSE Officer-22 - Site", "0563747432"),
      ],
    },
    {
      name: "Logistics Team",
      rows: [
        { name: "[Name]", position: "[Position]", number: "[Number]", email: "" },
      ],
    },
    {
      name: "SCC Team",
      rows: [
        person("Safiah Josh", "SCC Operator", ""),
        person("Sarah AlSubaie", "SCC Operator", ""),
      ],
    },
  ],
  emergency: {
    landline: "911",
    mobile: "013-673-0911",
    areas: [{ label: "Northern Area", number: "013-673-0911" }],
  },
  hospitals: [
    { name: "Ras Tanura General Hospital", number: "013-667-4444" },
  ],
};

export const CONTACTS_BY_PROJECT: Record<ContactProjectId, ProjectContacts> = {
  Jafurah: JAFURAH_PACK,
  MGS: MGS_PACK,
  Yanbu: YANBU_PACK,
  "Ras Tanura": RAS_TANURA_PACK,
  Dhahran: emptyProjectPack("Dhahran"),
};

/** Bump when seed packs change so the contacts page reloads fresh data. */
export const CONTACTS_SEED_REV = 6;
