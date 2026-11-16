// Clinic Care — data layer. Everything that reads or writes stored data lives here,
// so it can later be swapped for API calls without touching the screens in app.js.

const STORE = 'fieldnote-hms-v1'; // key kept from the original name so saved data still loads
const SESSION = 'clinic-care-session';

/* ---------- Reference data ---------- */

const VISIT_TYPES = ['General consultation', 'Follow-up', 'Wellness check', 'Vaccination', 'Dental check-up'];
const STATUSES = ['Confirmed', 'Checked in', 'Waiting', 'Completed', 'Cancelled'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PAYERS = ['Cash', 'SHA', 'Private insurance'];
const PAYMENT_METHODS = ['Cash', 'M-Pesa', 'SHA', 'Insurance'];

// Demo prices in KES — replace with the clinic's real tariff.
const SERVICE_PRICES = {
  'General consultation': 1000,
  'Follow-up': 500,
  'Wellness check': 1500,
  'Vaccination': 300,
  'Dental check-up': 1500,
  'Blood pressure check': 300
};

// `cls` is used for allergy checks (e.g. a penicillin allergy blocks amoxicillin).
// `fixed` items are dispensed as one unit regardless of dose and duration.
const FORMULARY = [
  { name: 'Paracetamol 500mg tab', cls: 'analgesic', price: 2 },
  { name: 'Ibuprofen 400mg tab', cls: 'nsaid', price: 5 },
  { name: 'Amoxicillin 500mg cap', cls: 'penicillin', price: 10 },
  { name: 'Amoxicillin/clavulanate 625mg tab', cls: 'penicillin', price: 35 },
  { name: 'Azithromycin 500mg tab', cls: 'macrolide', price: 40 },
  { name: 'Ciprofloxacin 500mg tab', cls: 'fluoroquinolone', price: 15 },
  { name: 'Metronidazole 400mg tab', cls: 'nitroimidazole', price: 5 },
  { name: 'Co-trimoxazole 960mg tab', cls: 'sulfonamide', price: 6 },
  { name: 'Artemether/lumefantrine 20/120mg tab', cls: 'antimalarial', price: 12 },
  { name: 'Amlodipine 5mg tab', cls: 'calcium channel blocker', price: 5 },
  { name: 'Metformin 500mg tab', cls: 'biguanide', price: 4 },
  { name: 'Omeprazole 20mg cap', cls: 'ppi', price: 6 },
  { name: 'Cetirizine 10mg tab', cls: 'antihistamine', price: 5 },
  { name: 'Salbutamol 100mcg inhaler', cls: 'bronchodilator', price: 450, fixed: true },
  { name: 'ORS sachet', cls: 'rehydration', price: 20 }
];

const FREQUENCIES = { OD: 1, BD: 2, TDS: 3, QID: 4, PRN: 3 };
const FREQUENCY_LABELS = { OD: 'Once daily', BD: 'Twice daily', TDS: 'Three times daily', QID: 'Four times daily', PRN: 'As needed' };

const DIAGNOSES = [
  'A09 Diarrhoea and gastroenteritis',
  'B54 Malaria, unspecified',
  'E11.9 Type 2 diabetes mellitus',
  'I10 Essential (primary) hypertension',
  'J06.9 Acute upper respiratory infection',
  'J18.9 Pneumonia, unspecified',
  'J45.9 Asthma, unspecified',
  'K02.9 Dental caries, unspecified',
  'K29.7 Gastritis, unspecified',
  'L30.9 Dermatitis, unspecified',
  'M54.5 Low back pain',
  'N39.0 Urinary tract infection',
  'R50.9 Fever, unspecified',
  'Z00.0 General adult medical examination',
  'Z23 Encounter for immunization'
];

/* ---------- Roles ---------- */

const ROLES = {
  admin: 'Clinic administrator',
  reception: 'Front desk',
  nurse: 'Nurse',
  doctor: 'Clinician'
};

const PERMISSIONS = {
  'patients.edit': ['admin', 'reception', 'nurse', 'doctor'],
  'patients.archive': ['admin'],
  'appointments.edit': ['admin', 'reception', 'nurse', 'doctor'],
  'clinical.view': ['admin', 'nurse', 'doctor'],
  'vitals.record': ['nurse', 'doctor'],
  'notes.write': ['doctor'],
  'billing.view': ['admin', 'reception'],
  'team.manage': ['admin']
};

/* ---------- Dates ---------- */

function localDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayISO() {
  return isoDate(new Date());
}

function parseISO(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- Seed data ---------- */

function makeSeed() {
  const day = offset => isoDate(localDate(offset));
  const at = (offset, hhmm) => `${day(offset)}T${hhmm}`;
  return {
    patients: [
      { id: 'FN-0248', name: 'Amara Njoroge', sex: 'Female', phone: '+254 712 345 678', dob: '1991-04-16', nationalId: '', allergies: '', conditions: '', kinName: 'Joseph Njoroge', kinPhone: '+254 712 000 111', payer: 'SHA', memberNo: 'SHA-4471023', visit: 'General consultation', lastVisit: day(0), registered: day(-1) },
      { id: 'FN-0247', name: 'David Kamau', sex: 'Male', phone: '+254 722 180 449', dob: '1983-08-22', nationalId: '', allergies: '', conditions: 'Hypertension', kinName: '', kinPhone: '', payer: 'Private insurance', memberNo: 'PI-88213', visit: 'Follow-up', lastVisit: day(0), registered: day(-4) },
      { id: 'FN-0246', name: 'Lila Wanjiku', sex: 'Female', phone: '+254 701 853 902', dob: '1997-12-03', nationalId: '', allergies: '', conditions: '', kinName: '', kinPhone: '', payer: 'Cash', memberNo: '', visit: 'Wellness check', lastVisit: day(0), registered: day(-6) },
      { id: 'FN-0245', name: 'Peter Otieno', sex: 'Male', phone: '+254 733 410 285', dob: '1975-02-11', nationalId: '', allergies: 'Penicillin', conditions: '', kinName: 'Ruth Otieno', kinPhone: '+254 733 222 019', payer: 'Cash', memberNo: '', visit: 'General consultation', lastVisit: day(-1), registered: day(-40) },
      { id: 'FN-0244', name: 'Zuri Mwende', sex: 'Female', phone: '+254 710 287 331', dob: '2018-06-30', nationalId: '', allergies: '', conditions: '', kinName: 'Agnes Mwende', kinPhone: '+254 710 287 330', payer: 'SHA', memberNo: 'SHA-1180274', visit: 'Vaccination', lastVisit: day(-1), registered: day(-120) },
      { id: 'FN-0243', name: 'Noah Kiptoo', sex: 'Male', phone: '+254 722 913 057', dob: '2002-10-09', nationalId: '', allergies: '', conditions: '', kinName: '', kinPhone: '', payer: 'Cash', memberNo: '', visit: 'Dental check-up', lastVisit: day(-5), registered: day(-200) },
      { id: 'FN-0242', name: 'Miriam Wekesa', sex: 'Female', phone: '+254 711 604 218', dob: '1968-05-27', nationalId: '', allergies: 'Sulfa drugs', conditions: 'Hypertension, Type 2 diabetes', kinName: '', kinPhone: '', payer: 'SHA', memberNo: 'SHA-0937716', visit: 'Follow-up', lastVisit: day(0), registered: day(-365) }
    ],
    appointments: [
      { id: 'a1', date: day(0), time: '09:00', patientId: 'FN-0248', type: 'General consultation', doctor: 'Dr. James Mwangi', status: 'Checked in', arrivedAt: '08:54' },
      { id: 'a6', date: day(0), time: '09:15', patientId: 'FN-0242', type: 'Blood pressure check', doctor: 'Dr. Sarah Kimani', status: 'Checked in', arrivedAt: '09:22' },
      { id: 'a2', date: day(0), time: '09:30', patientId: 'FN-0247', type: 'Follow-up · Blood pressure', doctor: 'Dr. Sarah Kimani', status: 'Waiting', arrivedAt: '09:18' },
      { id: 'a3', date: day(0), time: '10:15', patientId: 'FN-0246', type: 'Wellness check', doctor: 'Dr. Leah Otieno', status: 'Confirmed' },
      { id: 'a4', date: day(0), time: '11:00', patientId: 'FN-0245', type: 'General consultation', doctor: 'Dr. James Mwangi', status: 'Confirmed' },
      { id: 'a5', date: day(0), time: '11:30', patientId: 'FN-0244', type: 'Vaccination', doctor: 'Peter Wambua', status: 'Confirmed' },
      { id: 'a7', date: day(-1), time: '14:00', patientId: 'FN-0245', type: 'General consultation', doctor: 'Dr. James Mwangi', status: 'Completed', arrivedAt: '13:52' }
    ],
    // `days` is the weekly roster (0 = Sunday); `away` lists dates someone is off despite the roster.
    team: [
      { name: 'Dr. James Mwangi', role: 'General practitioner', days: [1, 2, 3, 4, 5], away: [] },
      { name: 'Dr. Sarah Kimani', role: 'Family medicine', days: [1, 2, 3, 4, 5], away: [] },
      { name: 'Dr. Leah Otieno', role: 'Paediatrician', days: [1, 3, 5], away: [] },
      { name: 'Peter Wambua', role: 'Registered nurse', days: [1, 2, 3, 4, 5, 6], away: [] },
      { name: 'Dr. Brian Ochieng', role: 'Dental surgeon', days: [2, 4], away: [] },
      { name: 'Grace Achieng', role: 'Clinical officer', days: [0, 6], away: [] }
    ],
    // Sign-in accounts. Separate from `team`, which is the clinical duty roster.
    users: [
      { id: 'u-alex', name: 'Alex Morgan', role: 'admin' },
      { id: 'u-faith', name: 'Faith Njeri', role: 'reception' },
      { id: 'u-peter', name: 'Peter Wambua', role: 'nurse' },
      { id: 'u-james', name: 'Dr. James Mwangi', role: 'doctor' },
      { id: 'u-sarah', name: 'Dr. Sarah Kimani', role: 'doctor' }
    ],
    vitals: [
      { id: 'v1', patientId: 'FN-0247', appointmentId: 'a2', at: at(0, '09:24'), by: 'Peter Wambua', sys: 148, dia: 94, temp: 36.7, pulse: 82, resp: 16, spo2: 98, weight: 88, height: 176 },
      { id: 'v2', patientId: 'FN-0245', appointmentId: 'a7', at: at(-1, '13:58'), by: 'Peter Wambua', sys: 128, dia: 82, temp: 38.4, pulse: 96, resp: 18, spo2: 97, weight: 74, height: 171 },
      { id: 'v3', patientId: 'FN-0242', appointmentId: null, at: at(-30, '10:05'), by: 'Peter Wambua', sys: 152, dia: 96, temp: 36.5, pulse: 78, resp: 16, spo2: 97, weight: 81, height: 163 }
    ],
    notes: [
      {
        id: 'n1', patientId: 'FN-0245', appointmentId: 'a7', date: day(-1), type: 'General consultation',
        complaint: 'Cough and fever for 3 days, sore throat.',
        findings: 'Temp 38.4 °C. Throat inflamed, chest clear on auscultation.',
        diagnosis: 'J06.9 Acute upper respiratory infection',
        plan: 'Symptomatic treatment, plenty of fluids. Return if not improving in 5 days or if breathing becomes difficult.',
        prescriptions: [{ drug: 'Paracetamol 500mg tab', dose: 2, freq: 'TDS', days: 5, qty: 30 }],
        author: 'Dr. James Mwangi', createdAt: at(-1, '14:20'), amendments: []
      }
    ],
    invoices: [
      {
        id: 'INV-0001', patientId: 'FN-0245', appointmentId: 'a7', date: day(-1),
        items: [{ desc: 'General consultation', qty: 1, price: 1000 }, { desc: 'Paracetamol 500mg tab', qty: 30, price: 2 }],
        payments: [{ method: 'M-Pesa', amount: 1060, ref: 'SKL4H7Q2RT', at: at(-1, '14:31'), by: 'Faith Njeri' }]
      },
      {
        id: 'INV-0002', patientId: 'FN-0243', appointmentId: null, date: day(-5),
        items: [{ desc: 'Dental check-up', qty: 1, price: 1500 }],
        payments: [{ method: 'Cash', amount: 500, ref: '', at: at(-5, '11:10'), by: 'Faith Njeri' }]
      }
    ]
  };
}

/* ---------- IDs ---------- */

const PATIENT_ID = /^FN-(\d+)$/;

function nextPatientId(patients) {
  const nums = patients.map(p => Number(PATIENT_ID.exec(p.id)?.[1])).filter(Number.isFinite);
  return `FN-${String(Math.max(0, ...nums) + 1).padStart(4, '0')}`;
}

function nextInvoiceId(invoices) {
  const nums = invoices.map(i => Number(/^INV-(\d+)$/.exec(i.id)?.[1])).filter(Number.isFinite);
  return `INV-${String(Math.max(0, ...nums) + 1).padStart(4, '0')}`;
}

/* ---------- Load / save ---------- */

// Upgrades data saved by older versions: records linked by patient name, display-text
// "last visit" values, duplicate "FN-0NaN" IDs, the old separate arrivals list, and
// collections or fields that didn't exist yet.
function migrate(data) {
  const seen = new Set();
  const valid = [];
  for (const p of data.patients) {
    if (!PATIENT_ID.test(p.id) || seen.has(p.id)) p.id = nextPatientId(valid);
    seen.add(p.id);
    valid.push(p);
    if (!('lastVisit' in p)) p.lastVisit = /^\d{4}-\d{2}-\d{2}$/.test(p.last) ? p.last : null;
    p.registered ??= null;
    for (const field of ['sex', 'nationalId', 'allergies', 'conditions', 'kinName', 'kinPhone', 'memberNo']) p[field] ??= '';
    p.payer ??= 'Cash';
    p.archived ??= false;
    delete p.last;
    delete p.notes;
  }

  // Old data enforced unique names, so name → ID is unambiguous here.
  const idByName = new Map(data.patients.map(p => [p.name.toLowerCase(), p.id]));
  const link = r => {
    if (!r.patientId) r.patientId = idByName.get(String(r.patient ?? r.name ?? '').toLowerCase()) ?? null;
  };
  data.appointments.forEach(a => {
    link(a);
    delete a.initials;
    if (inWaitingRoom(a) && !a.arrivedAt) a.arrivedAt = a.time;
  });
  data.notes.forEach(n => {
    link(n);
    n.prescriptions ??= [];
    n.amendments ??= [];
    n.author ??= null;
  });
  data.team.forEach(m => {
    m.days ??= [1, 2, 3, 4, 5];
    m.away ??= [];
    delete m.initials;
  });
  return data;
}

function loadState() {
  const seed = makeSeed();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved && Array.isArray(saved.patients) && Array.isArray(saved.appointments)) {
      return migrate({
        patients: saved.patients,
        appointments: saved.appointments,
        team: saved.team ?? seed.team,
        users: saved.users ?? seed.users,
        notes: saved.notes ?? [],
        vitals: saved.vitals ?? [],
        invoices: saved.invoices ?? []
      });
    }
  } catch {}
  return seed;
}

function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    showToast('Could not save in this browser. Check available storage.');
  }
}

let state = loadState();

/* ---------- Queries ---------- */

function patientById(id) {
  return state.patients.find(p => p.id === id);
}

// Records keep the old name as a fallback in case the patient record is missing.
function patientName(record) {
  return patientById(record.patientId)?.name ?? record.patient ?? record.name ?? 'Unknown patient';
}

function markVisited(patientId, date) {
  const p = patientById(patientId);
  if (p && (!p.lastVisit || date > p.lastVisit)) p.lastVisit = date;
}

// "Checked in" = arrived, awaiting triage; "Waiting" = triaged and ready for the clinician.
// Completing or cancelling the appointment takes the patient out of the waiting room.
function inWaitingRoom(a) {
  return a.status === 'Checked in' || a.status === 'Waiting';
}

function todaysAppointments() {
  const today = todayISO();
  return state.appointments.filter(a => a.date === today && a.status !== 'Cancelled');
}

function waitingRoom() {
  return todaysAppointments()
    .filter(inWaitingRoom)
    .sort((a, b) => (a.arrivedAt ?? a.time).localeCompare(b.arrivedAt ?? b.time));
}

function setStatus(appt, status) {
  if (status === appt.status) return;
  if (inWaitingRoom({ status }) && !inWaitingRoom(appt)) appt.arrivedAt = appt.date === todayISO() ? nowHHMM() : appt.time;
  if (!inWaitingRoom({ status }) && status !== 'Completed') delete appt.arrivedAt;
  appt.status = status;
  if (status === 'Checked in' || status === 'Completed') markVisited(appt.patientId, appt.date);
}

function teamMember(name) {
  return state.team.find(m => m.name === name);
}

function isOnDuty(member, date = new Date()) {
  return member.days.includes(date.getDay()) && !member.away.includes(isoDate(date));
}

function patientVitals(patientId) {
  return state.vitals.filter(v => v.patientId === patientId).sort((a, b) => b.at.localeCompare(a.at));
}

function patientNotes(patientId) {
  return state.notes.filter(n => n.patientId === patientId).sort((a, b) => (b.createdAt ?? b.date).localeCompare(a.createdAt ?? a.date));
}

function servicePrice(type) {
  const key = Object.keys(SERVICE_PRICES).find(k => String(type).startsWith(k));
  return key ? SERVICE_PRICES[key] : SERVICE_PRICES['General consultation'];
}

function drugByName(name) {
  return FORMULARY.find(d => d.name === name);
}

function prescriptionQty(drug, dose, freq, days) {
  return drug.fixed ? 1 : Math.ceil(dose * (FREQUENCIES[freq] ?? 1) * days);
}

// Returns the matching allergy term if the patient's recorded allergies cover this drug.
function allergyConflict(patient, drug) {
  const terms = String(patient?.allergies ?? '').toLowerCase().split(/[,;]/).map(t => t.trim()).filter(Boolean);
  const name = drug.name.toLowerCase();
  const cls = drug.cls.toLowerCase();
  return terms.find(t => {
    const stem = t.replace(/s$/, '').replace(/ drug$/, '');
    return name.includes(stem) || cls.includes(stem) || (stem.startsWith('sulfa') && cls === 'sulfonamide');
  });
}

function invoiceTotal(inv) {
  return inv.items.reduce((sum, i) => sum + i.qty * i.price, 0);
}

function invoicePaid(inv) {
  return inv.payments.reduce((sum, p) => sum + p.amount, 0);
}

function invoiceBalance(inv) {
  return invoiceTotal(inv) - invoicePaid(inv);
}

function invoiceStatus(inv) {
  const paid = invoicePaid(inv);
  return paid >= invoiceTotal(inv) ? 'Paid' : paid > 0 ? 'Part paid' : 'Unpaid';
}

/* ---------- Vitals assessment ---------- */

function bmi(v) {
  return v.weight && v.height ? v.weight / (v.height / 100) ** 2 : null;
}

// Adult reference ranges; flags are prompts for the clinician, not a diagnosis.
function vitalFlags(v) {
  const flags = [];
  const add = (level, label) => flags.push({ level, label });
  if (v.sys && v.dia) {
    if (v.sys >= 180 || v.dia >= 120) add('critical', `BP ${v.sys}/${v.dia} — very high`);
    else if (v.sys >= 140 || v.dia >= 90) add('warn', `BP ${v.sys}/${v.dia} — high`);
    else if (v.sys < 90) add('warn', `BP ${v.sys}/${v.dia} — low`);
  }
  if (v.temp) {
    if (v.temp >= 39.5) add('critical', `Temp ${v.temp} °C — high fever`);
    else if (v.temp >= 38) add('warn', `Temp ${v.temp} °C — fever`);
    else if (v.temp < 35.5) add('warn', `Temp ${v.temp} °C — low`);
  }
  if (v.pulse) {
    if (v.pulse > 130 || v.pulse < 40) add('critical', `Pulse ${v.pulse}`);
    else if (v.pulse > 100) add('warn', `Pulse ${v.pulse} — fast`);
    else if (v.pulse < 50) add('warn', `Pulse ${v.pulse} — slow`);
  }
  if (v.spo2) {
    if (v.spo2 < 90) add('critical', `SpO₂ ${v.spo2}%`);
    else if (v.spo2 < 94) add('warn', `SpO₂ ${v.spo2}% — low`);
  }
  if (v.resp && (v.resp > 24 || v.resp < 10)) add('warn', `Resp. rate ${v.resp}`);
  return flags;
}
