"""Default Key Personnel packs stored in AppState (SQLite / Postgres)."""

from __future__ import annotations


def _person(name: str, position: str, number: str, email: str = "") -> dict:
    return {"name": name, "position": position, "number": number, "email": email}


def _empty_rows(positions: list[str]) -> list[dict]:
    return [
        {"name": "[Name]", "position": position, "number": "[Number]", "email": ""}
        for position in positions
    ]


def empty_project_pack(project_id: str) -> dict:
    return {
        "id": project_id,
        "division": "",
        "title": f"{project_id} Project – Key Personnel & Emergency Contacts",
        "contract": "",
        "client": "Saudi Aramco",
        "hotline": "",
        "placeholder": True,
        "groups": [
            {
                "name": "Saudi Aramco PMT",
                "rows": _empty_rows(
                    [
                        "SAPMT Lead Engineer",
                        "SAPMT Project Engineer",
                        "Field Compliance Coordinator",
                    ]
                ),
            },
            {
                "name": "Bin Quraya",
                "red": True,
                "rows": _empty_rows(
                    [
                        "Project Manager",
                        "Construction Manager",
                        "HSE Manager",
                    ]
                ),
            },
            {
                "name": "Safety Team",
                "rows": _empty_rows(
                    ["Safety Manager", "Safety Supervisor", "Project Medic"]
                ),
            },
            {
                "name": "Logistics Team",
                "rows": _empty_rows(["Logistics Coordinator"]),
            },
            {
                "name": "SCC Team",
                "rows": _empty_rows(["SCC Operator"]),
            },
        ],
        "hospitals": [{"name": "[Nearest hospital]", "number": "[Number]"}],
    }


def jafurah_pack() -> dict:
    return {
        "id": "Jafurah",
        "division": "Riyas Pipeline Project Division",
        "title": "Jafurah Downstream Pipeline Project Division (JFDP)",
        "contract": "Contract No.: 6601000358 / BI-10-14245",
        "client": "Saudi Aramco",
        "hotline": "",
        "groups": [
            {
                "name": "Saudi Aramco PMT",
                "rows": [
                    _person("Jason Michael", "Division Safety Lead - Riyas", "0505903583"),
                    _person("Hassan Ismailu", "Lead Project Engineer - Riyas", "0532862207"),
                    _person("Abdullah Hussain", "Project Engineer - Riyas", "0597409025"),
                    _person("Awad Al Harbi", "SAPMT PCC - Riyas", "0531249446"),
                    _person("Alfredo Mandoza", "SAPMT PCC - Riyas", "0503596149"),
                    _person(
                        "Dhahran Shift Manager",
                        "Saudi Aramco Operations, Dhahran Corridor - Jafurah South",
                        "0506837304",
                    ),
                    _person(
                        "Ibrahim M Deran",
                        "SA PPD Project Manager - Jafurah South",
                        "0547744565",
                    ),
                    _person(
                        "Khalid Algharbi",
                        "SA PPD Supervisor - Jafurah South",
                        "0538041260",
                    ),
                    _person(
                        "Saeed Alshurayet",
                        "SAPMT Field Compliance Coordinator - Jafurah South",
                        "0504917045",
                    ),
                    _person(
                        "Tarlan Hasanov",
                        "SAPMT Field Compliance Coordinator - Jafurah South",
                        "0502101715",
                    ),
                    _person(
                        "Carlos Cayabyab",
                        "SAPMT Field Compliance Coordinator - Jafurah South",
                        "0554754784",
                    ),
                ],
            },
            {
                "name": "Bin Quraya",
                "red": True,
                "rows": [
                    _person(
                        "Shaukat Ali",
                        "Senior Project Manager",
                        "0551350432 / 0555072936",
                    ),
                    _person(
                        "Mohammed Mousa",
                        "Sr. Construction Manager - Riyas",
                        "0532752113",
                    ),
                    _person(
                        "Omer Suliman",
                        "Senior Construction Manager - Jafurah South",
                        "0500753616",
                    ),
                    _person(
                        "Muhammad Sharafuddin",
                        "Construction Manager - Jafurah South",
                        "0580767697",
                    ),
                    _person(
                        "Ibrahim Quraishi",
                        "Construction Manager - Jafurah South",
                        "0534505305",
                    ),
                    _person(
                        "Otthmane Taofiq",
                        "Construction Superintendent - Jafurah South",
                        "0583316607",
                    ),
                ],
            },
            {
                "name": "Safety Team",
                "rows": [
                    _person("Usman Iqbal", "Safety Manager", "0557875932"),
                    _person(
                        "Rolando Manio",
                        "Safety Coordinator - ERT Leader - Riyas",
                        "0565636416 / 0541828096",
                    ),
                    _person(
                        "Francisco Casem",
                        "Safety Coordinator - Jafurah South",
                        "0572393583",
                    ),
                    _person(
                        "Johnlery Ronda Diaz",
                        "Safety Supervisor - Search & Rescue Coordinator - Riyas",
                        "0553539049 / 0533539049",
                    ),
                    _person(
                        "Rhoy (Rolando) Oliveria",
                        "Safety Supervisor - Search & Rescue Coordinator - Riyas",
                        "0561015767",
                    ),
                    _person(
                        "Syed Mateen Hussaini",
                        "Safety Supervisor - First Aider - Riyas",
                        "0596856632",
                    ),
                    _person(
                        "Bengel Albana Venus",
                        "Safety Supervisor - Jafurah South",
                        "0542916843",
                    ),
                    _person("Malik Junaid", "Safety Supervisor - Jafurah South", "0591338824"),
                    _person("Ahmad Hassan", "Environmental Coordinator - Riyas", "0552182584"),
                    _person("Selvam Kamaraj", "Male Nurse - Riyas", "0548079938"),
                    _person(
                        "Md. Shakil Hossain",
                        "Ambulance Driver (24 hours) - Riyas",
                        "0555347143",
                    ),
                    _person("Vishnu Sukumaran", "Male Nurse - Jafurah South", "0504788178"),
                    _person("Salim Abdul Rajak", "Male Nurse - Jafurah South", "0536317344"),
                    _person("Sobuj Mia", "Ambulance Driver - Jafurah South", "0572688840"),
                    _person("Sheraz", "Ambulance Driver - Jafurah South", "0534698030"),
                    _person("Shahzada Omer", "First Aider - Riyas ERT", "0557394280"),
                    _person("Joel David", "First Aider - Riyas ERT", "0544122695"),
                    _person("Zeeshan Mushood", "First Aider - Riyas ERT", "0554828142"),
                    _person("Juniper Premacio", "First Aider - Riyas ERT", "0537786852"),
                    _person("Reneboy Bagsic", "First Aider - Riyas ERT", "0551449573"),
                    _person("Abdul Razzaq", "First Aider - Riyas ERT", "0573259836"),
                    _person("Motilal Prajapati", "First Aider - Riyas ERT", "0571850958"),
                    _person("Umair Shabbir", "First Aider - Riyas ERT", "0581620521"),
                    _person("Ofori Ebenezer", "First Aider - Riyas ERT", "0594076285"),
                    _person("Danish Imam", "First Aider - Riyas ERT", "0530510820"),
                ],
            },
            {
                "name": "Logistics Team",
                "rows": [
                    _person("Muhammad Ali", "Transport Coordinator - Riyas", "0583361450"),
                    _person(
                        "Haidar Mohammed A Almuhaysin",
                        "Traffic Coordinator - Jafurah South",
                        "0544944982",
                    ),
                    _person("Rajesh", "Fire Water Truck - Riyas", "0543263848"),
                    _person("Laxman Tamang", "Fire Water Truck - Riyas", "0573097579"),
                ],
            },
            {
                "name": "SCC Team",
                "rows": [
                    _person(
                        "Mohammed Jafar AlMubaireek",
                        "SCC Communication - Riyas",
                        "0543657847",
                    ),
                    _person("Mohd Afzaal", "SCC Operator", ""),
                    _person("Muhammad Nawaz", "SCC Operator", ""),
                ],
            },
        ],
        "emergency": {
            "landline": "911",
            "mobile": "013-673-0911 (Riyas), 013-679-0911 (Jafurah South)",
            "areas": [
                {"label": "Northern Area (Ras Tanura)", "number": "013-679-0911"},
                {"label": "Southern Area", "number": "013-572-0911"},
                {"label": "Central Area", "number": "013-872-0911"},
                {"label": "Riyas NGL", "number": "013-673-0911"},
                {"label": "Juaymah", "number": "013-677-0911"},
            ],
        },
        "hospitals": [
            {
                "name": "Riyas - Jubail General Hospital (animal bites, road accidents, H2S)",
                "number": "013-362-2233",
            },
            {"name": "Riyas - Royal Commission Hospital", "number": "013-346-4090"},
            {"name": "Riyas - KIMS Hospital Jubail", "number": "053-264-0033"},
            {"name": "Riyas - Ras Tanura General Hospital", "number": "013-667-4444"},
            {
                "name": "Jafurah South - King Fahad Hospital (Hofuf)",
                "number": "013-535-4444",
            },
            {"name": "Jafurah South - Al-Hasa Hospital", "number": "013-538-4666"},
            {"name": "Jafurah South - General Hospital Abqaiq", "number": "013-566-2222"},
            {
                "name": "Jafurah South - Al-Dosary Hospital (Al-Khobar)",
                "number": "013-801-1910",
            },
        ],
    }


def mgs_pack() -> dict:
    return {
        "id": "MGS",
        "division": "Master Gas Central Region Pipeline Division",
        "title": "Master Gas System Expansion Phase III",
        "contract": "Contract No.: 6601019403 / BI-49-14044",
        "client": "Saudi Aramco",
        "hotline": "0539513330",
        "groups": [
            {
                "name": "Saudi Aramco PMT",
                "rows": [
                    _person("Ahmed Alhelal", "SAPMT Lead Engineer", "0553684376"),
                    _person(
                        "Saif Al Onazi",
                        "SAPMT Safety Advisor / Field Compliance Coordinator",
                        "0551468652",
                    ),
                    _person("Rexand Carriaga", "SAPMT Engineer", "0541835757"),
                ],
            },
            {
                "name": "Bin Quraya",
                "red": True,
                "rows": [
                    _person(
                        "Zaid Nawwaf AlEitan",
                        "Sr. Project Manager - Incident Commander",
                        "0582996371",
                    ),
                    _person(
                        "Faheem Shehzad",
                        "Construction Manager - Field Incident Commander",
                        "0549529097",
                    ),
                    _person("Syed Saddam Hussain", "Construction Manager", "0551388702"),
                    _person("Imran Zafar", "Admin", "0541316950"),
                    _person("Fahad Javed", "DC / Time Keeper", "0537068357"),
                ],
            },
            {
                "name": "Safety Team",
                "rows": [
                    _person("Syed Adnan Haider", "HSE Manager", "0508412676"),
                    _person("Bilal Khan", "Asst. Safety Manager", "0532981345"),
                    _person("Hammad Hanif", "Safety Supervisor", "0505341681"),
                    _person("Benny Joseph", "Safety Supervisor", "0539811156"),
                    _person("Teresito Garcia", "Safety Supervisor", "0558037279"),
                    _person("Hafiz Zaid", "Safety Supervisor", "0556635397"),
                    _person("Ibrahim Nawfal AK", "SMS Coordinator", "0509770531"),
                    _person("Haseeb Khizar", "Male Nurse (BQ Clinic)", "0575337646"),
                    _person("Ahmad Elbadry", "Male Nurse", "0552635109"),
                    _person(
                        "Mohamed Saad Aboelenen Aied",
                        "Male Nurse (Aramco Clinic)",
                        "0583350123",
                    ),
                    _person("M. Junaid", "Male Nurse", "0547724812"),
                    _person("Muhammad Umar Khaja", "Male Nurse", "0539625718"),
                    _person("Jamrad Khan", "Ambulance Driver (Aramco)", "0580732092"),
                    _person("Ahmad Aliyan", "Ambulance Driver", "0560983472"),
                    _person("Moses Narh", "Ambulance Driver", "0541986321"),
                    _person(
                        "Taha Garhei Ali Ibrahim",
                        "Ambulance Driver",
                        "0539294286",
                    ),
                    _person("Noor Zaman", "First Aider", "0556345217"),
                    _person("Muhammad Asghar Ali", "First Aider", "0539713678"),
                ],
            },
            {
                "name": "Logistics Team",
                "rows": [
                    _person(
                        "Mohammad Amair Sohel",
                        "Logistic Coordinator / Maintenance Engineer",
                        "0530511658",
                    ),
                    _person("Taalam Khan", "Equipment Coordinator", "0549867006"),
                    _person("Ansar Basha", "Camp Boss", "0550456168"),
                ],
            },
            {
                "name": "SCC Team",
                "rows": [
                    _person("Altayeb Altayeb", "SCC Manager", "0542248998"),
                    _person("Tahani AlMohammed", "SCC Coordinator", "0564236994"),
                    _person("Hazem AlGrainees", "SCC Operator", "0550690033"),
                    _person(
                        "Mohammed AlAbdli",
                        "IT & Network Engineering",
                        "0559219080",
                    ),
                ],
            },
        ],
        "emergency": {
            "landline": "911",
            "mobile": "013-574-0911",
            "areas": [
                {"label": "Riyadh", "number": "011-285-0911"},
                {"label": "Pump Station", "number": "013-574-0911"},
            ],
        },
        "hospitals": [
            {
                "name": "Prince Mohammed bin Abdulaziz Hospital",
                "number": "800 127 7000 / +966 11 261 6666",
            },
            {"name": "Al Azhar Medical", "number": "0580633106"},
            {"name": "Rafa Medical Center", "number": "920005405"},
        ],
    }


def yanbu_pack() -> dict:
    return {
        "id": "Yanbu",
        "division": "East West Pipeline Project Division",
        "title": 'REPLACE 56" ABQAIQ-YANBU PIPELINE (AY-1L) SECTION 7',
        "contract": "Contract No.: 6601019567 / BI-10-01575",
        "client": "Saudi Aramco",
        "hotline": "0564238728",
        "groups": [
            {
                "name": "Saudi Aramco PMT",
                "rows": [
                    _person("Ahmad Lateef Daud", "SAPMT Lead Engineer", "0569007125"),
                    _person("Faris Asali", "SAPMT Project Engineer", "0531370487"),
                    _person("Muhammad Bilal", "SAPMT Sr. FCC", "0599359297"),
                    _person("Ahmed Bin Hajib", "SAPMT Sr. FCC", "0556511155"),
                    _person("Bayh Moaed A.", "SAPMT FCC", "0591033366"),
                    _person("Waleed Alsharif", "SAPMT FCC", "0505557111"),
                    _person(
                        "Syed Talha",
                        "SAPMT Facility Coordinator - TCF 1",
                        "0530164942",
                    ),
                ],
            },
            {
                "name": "Bin Quraya",
                "red": True,
                "rows": [
                    _person("Mohammed Osman", "Project Manager", "0569268702"),
                    _person("Senthil Kumar", "Construction Manager", "0550953913"),
                    _person("Abdul Raheem", "Project Engineer", "0564786028"),
                    _person(
                        "Ahmed Abdelsattar",
                        "Corporate Medical Service",
                        "0556183435",
                    ),
                    _person(
                        "Baqer Alshorit",
                        "Manager & Cybersecurity - IT",
                        "0508397459",
                    ),
                    _person("Mohd Saleh", "Security Supervisor", "0583875243"),
                ],
            },
            {
                "name": "Safety Team",
                "rows": [
                    _person("Enjamamul Haque", "Safety Manager", "0504506322"),
                    _person("Gopakumar M", "Deputy Safety Manager", "0595939082"),
                    _person("Ahamad Salim", "Safety Supervisor", "0552460778"),
                    _person(
                        "Shakil Ahamad",
                        "Safety Supervisor - KP 110 to 185",
                        "0599673820",
                    ),
                    _person(
                        "Muhammad Kashif Ghulam Nabi",
                        "Safety Supervisor - KP -7 to 110",
                        "0549746969",
                    ),
                    _person(
                        "Sehzad Sarfaraz",
                        "Environmental Coordinator",
                        "0531976701",
                    ),
                    _person(
                        "Mohammad Danish",
                        "Project Medic (Male Nurse) - TCF 1 - KP 110 to 185",
                        "0561249291",
                    ),
                    _person(
                        "Sher Khan",
                        "Ambulance Driver - TCF 1 - KP 110 to 185",
                        "0581372672",
                    ),
                    _person(
                        "Nyzam Salim",
                        "Project Medic (Male Nurse) - TCF 2 - KP 59 to 110",
                        "0550957950",
                    ),
                    _person(
                        "Naseer Khan",
                        "Ambulance Driver - TCF 2 - KP 59 to 110",
                        "0552764474",
                    ),
                    _person(
                        "Muhammad Rabee",
                        "Project Medic (Male Nurse) - TCF 3 - KP -7 to 59",
                        "0547818528",
                    ),
                    _person(
                        "Ajmal Khan",
                        "Ambulance Driver - TCF 3 - KP -7 to 59",
                        "0582510865",
                    ),
                    _person(
                        "Aftab Ahmed Khan Ali Khan",
                        "Safety Officer",
                        "0561455866",
                    ),
                    _person("Jitendra Yadav", "Safety Officer", "0573351377"),
                    _person("Brayner Allen", "Safety Officer", "0535428327"),
                    _person("Khan Gulam Sarwar", "Safety Officer", "0576283029"),
                    _person("Mohammed Sohailuddin", "Safety Officer", "0574585016"),
                    _person("Abid Ali", "Safety Officer", "0580152894"),
                    _person("Abdul Basit", "Safety Officer", "0553068293"),
                    _person("Shamaz Sheraz", "Safety Officer", "0534682327"),
                    _person("Jafar Iqbal", "Safety Officer", "0536714793"),
                    _person("Muqaddus Yasin", "Safety Officer", "0540580358"),
                    _person("Haider Usman", "Safety Officer", "0572886567"),
                    _person("Rizwan Mohd Ilyas", "Fire Warden", "0539135387"),
                    _person("MD Tahzzot Hosain", "Fire Warden", "0560383869"),
                    _person("Kamlesh Kumar", "Fire Warden", "0571512492"),
                    _person("Sundar Pasman", "Fire Warden", "0570163579"),
                    _person("Santosh Kumar", "Fire Warden", "0573090087"),
                    _person("MD Khalid", "Fire Warden", "0572149916"),
                    _person("Mohd Farhaz", "Fire Warden", "0571453828"),
                ],
            },
            {
                "name": "Logistics Team",
                "rows": [
                    _person(
                        "Rajkumar Singh",
                        "Equipment / Logistics Supervisor",
                        "0552468634",
                    ),
                    _person("Ratheesh Pillai", "Workshop Supervisor", "0538209876"),
                    _person("Shakir Hussain", "Camp Boss - TCF 1", "0598512638"),
                    _person("M. Jahanzaid", "Camp Boss - TCF 2", "0558732167"),
                    _person(
                        "Mohamed Ekramuddin",
                        "Camp Boss - TCF 3",
                        "0510782025",
                    ),
                    _person("Roberto A. Reyas", "Electrician", "0557142154"),
                    _person("Raj Pandit", "Plumber", "0571709422"),
                ],
            },
            {
                "name": "SCC Team",
                "rows": [
                    _person(
                        "Osama Almassar",
                        "Safety Command Center Operator",
                        "0559365448",
                    ),
                ],
            },
        ],
        "emergency": {
            "landline": "911",
            "mobile": "013-378-0911, 013-379-0911",
            "areas": [
                {"label": "Jeddah", "number": "012-427-0911"},
                {"label": "Yanbu", "number": "014-397-0911"},
                {"label": "Madinah", "number": "014-397-0911"},
            ],
        },
        "hospitals": [
            {"name": "Al Madinah Hospital", "number": "014-813-6001"},
            {"name": "Safa Al Madinah Hospital", "number": "014-844-0000"},
            {"name": "Madinah National Hospital", "number": "014-844-4444"},
            {"name": "Saudi German Hospital Madinah", "number": "920-007-997"},
            {"name": "Badr General Hospital", "number": "014-321-852"},
            {"name": "Al Yutmah Medical Service", "number": "014-854-3855"},
        ],
    }


def ras_tanura_pack() -> dict:
    return {
        "id": "Ras Tanura",
        "division": "Northern Area Pipeline Project Division",
        "title": "Increase AM Crude Supply to RT Terminal Project",
        "contract": "Contract No.: 6601015410 / BI-10-14609",
        "client": "Saudi Aramco",
        "hotline": "0509001883",
        "groups": [
            {
                "name": "Saudi Aramco PMT",
                "rows": [
                    _person(
                        "Maythem Al Sadah",
                        "Supervisor Project Engineer",
                        "0538605428",
                    ),
                    _person(
                        "Sulbaran Parra, Jose L",
                        "SAPMT Project Engineer",
                        "0555283319",
                    ),
                    _person(
                        "Alexender Ponraj",
                        "Field Compliance Coordinator",
                        "0536063255",
                    ),
                    _person(
                        "Vijumon",
                        "Field Compliance Coordinator",
                        "0597808854",
                    ),
                ],
            },
            {
                "name": "Bin Quraya",
                "red": True,
                "rows": [
                    _person("Ahmed Hemdan", "Project Manager", "0590723617"),
                    _person("Ali Alali", "Construction Manager", "0565843543"),
                    _person("Danilo Datu", "Construction Manager", "0596008480"),
                    _person("Hassan Noufal", "Construction Manager", "0599090850"),
                    _person("Erasad Ahmed", "Mechanical Engineer", "0581405732"),
                ],
            },
            {
                "name": "Safety Team",
                "rows": [
                    _person("Sirajul Islam", "HSE Manager", "0509001883"),
                    _person("Rolando", "HSE Trainer", "0561323190"),
                    _person(
                        "Zia Ur Rahman",
                        "Environmental Coordinator",
                        "0580948002 / 0580948022",
                    ),
                    _person("Geresh Babu", "SMS Coordinator", "0508163213"),
                    _person("Zawed Akhar", "HE Coordinator", "0510356482"),
                    _person("Raj Kishor Paswan", "PWAS Coordinator", "0575206945"),
                    _person("Wadud Khan", "Sr. HSE Supervisor", "0532892914"),
                    _person("Ahmad Ali", "HSE Supervisor", "0571808287"),
                    _person("Mahdi Hassan", "HSE Supervisor", "0566424122"),
                    _person("Thomas Kuriakose", "Male Nurse", "0571483254"),
                    _person("Mansour Meshmesh", "Male Nurse", "0558465907"),
                    _person("Mohammed Sumon", "Ambulance Driver", "0537016350"),
                    _person("Ahmed Shaar", "Ambulance Driver", "0554675521"),
                    _person(
                        "Faisal J. Al Mansor",
                        "HSE Officer (24 hours) - Camp / Office",
                        "0581705071",
                    ),
                    _person("Francis Torres", "HSE Officer-1 - Site", "0538983160"),
                    _person(
                        "Ahmed Yasir Abu R.",
                        "HSE Officer-2 - Site",
                        "0547836740",
                    ),
                    _person(
                        "Syed Ahmed Azath",
                        "HSE Officer-3 - Site",
                        "0500806559",
                    ),
                    _person("Rafiqul Islam", "HSE Officer-4 - Site", "0590398531"),
                    _person("Mustafa Khan", "HSE Officer-5 - Site", "0509752933"),
                    _person(
                        "Ibrahim Al Mashama",
                        "HSE Officer-6 - Site",
                        "0536643917",
                    ),
                    _person("Noor Mohammed", "HSE Officer-7 - Site", "0547562330"),
                    _person(
                        "Muhannad Alzahrani",
                        "HSE Officer-8 - Site",
                        "0545961943",
                    ),
                    _person("Yahya Ali Mirza", "HSE Officer-9 - Site", "0556299860"),
                    _person("Ranjith Dasan", "HSE Officer-10 - Site", "0510453387"),
                    _person("Hassan Almadan", "HSE Officer-11 - Site", "0563544320"),
                    _person("Ali Maidan", "HSE Officer-12 - Site", "054532448"),
                    _person(
                        "Mohammed Khaleel",
                        "HSE Officer-13 - Site",
                        "0564203417",
                    ),
                    _person("Abdul Hanan", "HSE Officer-14 - Site", "0572494652"),
                    _person(
                        "Hassan Raja Khan",
                        "HSE Officer-15 - Site",
                        "0501963500",
                    ),
                    _person("Mohammad Imran", "HSE Officer-16 - Site", "0537665673"),
                    _person("Mhad Benson", "HSE Officer-17 - Site", "0551761890"),
                    _person(
                        "Baqer Al Marhoon",
                        "HSE Officer-18 - Site",
                        "0541848119",
                    ),
                    _person("Naif Alomar", "HSE Officer-19 - Site", "0533501958"),
                    _person("Abdullah Albati", "HSE Officer-20 - Site", "0564320435"),
                    _person("Hussain Alzori", "HSE Officer-21 - Site", "0569642866"),
                    _person(
                        "Yassir Hussein (Scorpion)",
                        "HSE Officer-22 - Site",
                        "0563747432",
                    ),
                ],
            },
            {
                "name": "Logistics Team",
                "rows": [
                    {
                        "name": "[Name]",
                        "position": "[Position]",
                        "number": "[Number]",
                        "email": "",
                    }
                ],
            },
            {
                "name": "SCC Team",
                "rows": [
                    _person("Safiah Josh", "SCC Operator", ""),
                    _person("Sarah AlSubaie", "SCC Operator", ""),
                ],
            },
        ],
        "emergency": {
            "landline": "911",
            "mobile": "013-673-0911",
            "areas": [
                {"label": "Northern Area", "number": "013-673-0911"},
            ],
        },
        "hospitals": [
            {"name": "Ras Tanura General Hospital", "number": "013-667-4444"},
        ],
    }


def default_key_personnel_packs() -> dict:
    return {
        "Jafurah": jafurah_pack(),
        "MGS": mgs_pack(),
        "Yanbu": yanbu_pack(),
        "Ras Tanura": ras_tanura_pack(),
        "Dhahran": empty_project_pack("Dhahran"),
    }
