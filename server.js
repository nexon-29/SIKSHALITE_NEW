require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configured for both Render static frontend and local dev
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:5000'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.onrender.com')) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname)));

// ================= MongoDB Connection =================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sikshalite';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// ================= Mongoose Schemas =================
const institutionSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  name: { type: String, required: true },
  about: { type: String, default: '' },
  address: { type: String, default: '' },
  adminName: { type: String, required: true },
  adminMobile: { type: String, required: true },
  logo: { type: String, default: '' }
}, { timestamps: true });

const teacherSchema = new mongoose.Schema({
  institutionCode: { type: String, required: true, index: true },
  name: { type: String, required: true },
  subject: { type: String, required: true },
  mobile: { type: String, required: true },
  photo: { type: String, default: '' }
}, { timestamps: true });

const studentSchema = new mongoose.Schema({
  institutionCode: { type: String, required: true, index: true },
  uniqueId: { type: String, required: true, unique: true, uppercase: true },
  name: { type: String, required: true },
  className: { type: String, default: '' },
  photo: { type: String, default: '' }
}, { timestamps: true });

const questionSchema = new mongoose.Schema({
  question: String,
  options: [String],
  correctIndex: Number // 0..3
}, { _id: false });

const courseSchema = new mongoose.Schema({
  institutionCode: { type: String, required: true, index: true },
  teacherId: { type: String, default: '' },
  teacherName: { type: String, required: true },
  title: { type: String, required: true },
  subject: { type: String, required: true },
  summary: { type: String, default: '' },
  studyMaterial: { type: String, default: '' },
  images: [String],
  quiz: [questionSchema],
  assignmentTitle: { type: String, default: 'Assignment' },
  assignmentTask: { type: String, default: '' }
}, { timestamps: true });

const attemptSchema = new mongoose.Schema({
  institutionCode: { type: String, required: true, index: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  preSubmitted: { type: Boolean, default: false },
  preAnswers: [Number],
  preScore: { type: Number, default: 0 }, // 0..100
  postSubmitted: { type: Boolean, default: false },
  postAnswers: [Number],
  postScore: { type: Number, default: 0 }, // 0..100
  preSubmittedAt: Date,
  postSubmittedAt: Date
}, { timestamps: true });

const submissionSchema = new mongoose.Schema({
  institutionCode: { type: String, required: true, index: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  answer: { type: String, required: true },
  feedback: { type: String, default: '' },
  submittedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const Institution = mongoose.model('Institution', institutionSchema);
const Teacher = mongoose.model('Teacher', teacherSchema);
const Student = mongoose.model('Student', studentSchema);
const Course = mongoose.model('Course', courseSchema);
const Attempt = mongoose.model('Attempt', attemptSchema);
const Submission = mongoose.model('Submission', submissionSchema);

// In-memory OTP store for demo/SMS login
const otpStore = new Map();

// ================= Helpers =================
function generateCode(prefix, length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${out}`;
}

async function generateUniqueInstCode() {
  let code;
  let exists = true;
  while (exists) {
    code = generateCode('INS', 6);
    exists = await Institution.exists({ code });
  }
  return code;
}

async function generateUniqueStudentId() {
  let id;
  let exists = true;
  while (exists) {
    id = generateCode('STU', 6);
    exists = await Student.exists({ uniqueId: id });
  }
  return id;
}

function calcGrowthMetrics(pre, post) {
  const gain = post - pre;
  const growthRate = pre > 0 ? Math.round(((post - pre) / pre) * 100) : (post > 0 ? 100 : 0);
  const normGain = pre < 100 ? Math.round(((post - pre) / (100 - pre)) * 100) : 0;
  const normLevel = normGain >= 70 ? 'High' : (normGain >= 30 ? 'Medium' : 'Low');
  return { gain, growthRate, normGain, normLevel };
}

// ================= Health Route =================
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'SikshaLite API', dbState: mongoose.connection.readyState });
});

// ================= Institution & Auth Routes =================
app.post('/api/institutions/register', async (req, res) => {
  try {
    const { name, about, address, adminName, adminMobile, logo } = req.body;
    if (!name || !adminName || !adminMobile) {
      return res.status(400).json({ error: 'Institution name, admin name and mobile are required.' });
    }
    const code = await generateUniqueInstCode();
    const institution = await Institution.create({
      code,
      name: name.trim(),
      about: (about || '').trim(),
      address: (address || '').trim(),
      adminName: adminName.trim(),
      adminMobile: adminMobile.trim(),
      logo: logo || ''
    });

    res.status(201).json({
      institution,
      user: {
        role: 'admin',
        id: 'admin',
        name: institution.adminName,
        mobile: institution.adminMobile,
        institutionCode: institution.code
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { institutionCode, mobile } = req.body;
    const code = (institutionCode || '').trim().toUpperCase();
    const mob = (mobile || '').trim();

    const institution = await Institution.findOne({ code });
    if (!institution) return res.status(404).json({ error: 'Institution code not found.' });

    let role = null;
    let profile = null;

    if (institution.adminMobile === mob) {
      role = 'admin';
      profile = { id: 'admin', name: institution.adminName, mobile: mob };
    } else {
      const teacher = await Teacher.findOne({ institutionCode: code, mobile: mob });
      if (teacher) {
        role = 'teacher';
        profile = { id: String(teacher._id), name: teacher.name, subject: teacher.subject, mobile: mob };
      }
    }

    if (!role) {
      return res.status(404).json({ error: 'Mobile number is not registered as an admin or teacher in this institution.' });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(`${code}:${mob}`, { otp, role, profile, expiresAt: Date.now() + 10 * 60 * 1000 });

    // Demo mode returns demoOtp on screen; plug an SMS provider here for production
    res.json({ ok: true, demoOtp: otp, message: 'OTP generated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { institutionCode, mobile, otp } = req.body;
    const code = (institutionCode || '').trim().toUpperCase();
    const mob = (mobile || '').trim();
    const record = otpStore.get(`${code}:${mob}`);

    if (!record || record.expiresAt < Date.now() || record.otp !== String(otp).trim()) {
      return res.status(401).json({ error: 'Invalid or expired OTP.' });
    }

    otpStore.delete(`${code}:${mob}`);
    const institution = await Institution.findOne({ code });

    res.json({
      institution,
      user: {
        ...record.profile,
        role: record.role,
        institutionCode: code
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/student-login', async (req, res) => {
  try {
    const uniqueId = (req.body.uniqueId || '').trim().toUpperCase();
    const student = await Student.findOne({ uniqueId });
    if (!student) return res.status(404).json({ error: 'Student ID not found. Check with your teacher.' });

    const institution = await Institution.findOne({ code: student.institutionCode });
    res.json({
      institution,
      user: {
        role: 'student',
        id: String(student._id),
        uniqueId: student.uniqueId,
        name: student.name,
        className: student.className,
        photo: student.photo,
        institutionCode: student.institutionCode
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/institutions/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { name, about, address, adminName, adminMobile, logo } = req.body;
    const institution = await Institution.findOneAndUpdate(
      { code },
      { name, about, address, adminName, adminMobile, logo },
      { new: true }
    );
    res.json({ institution });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/institutions/:code/reset-scores', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    await Attempt.deleteMany({ institutionCode: code });
    await Submission.deleteMany({ institutionCode: code });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/institutions/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    await Promise.all([
      Institution.deleteOne({ code }),
      Teacher.deleteMany({ institutionCode: code }),
      Student.deleteMany({ institutionCode: code }),
      Course.deleteMany({ institutionCode: code }),
      Attempt.deleteMany({ institutionCode: code }),
      Submission.deleteMany({ institutionCode: code })
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= Teachers Routes =================
app.get('/api/institutions/:code/teachers', async (req, res) => {
  const teachers = await Teacher.find({ institutionCode: req.params.code.toUpperCase() }).sort({ createdAt: -1 });
  res.json({ teachers });
});

app.post('/api/institutions/:code/teachers', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { name, subject, mobile, photo } = req.body;
    const teacher = await Teacher.create({ institutionCode: code, name, subject, mobile, photo: photo || '' });
    res.status(201).json({ teacher });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teachers/:id', async (req, res) => {
  try {
    const { name, subject, mobile, photo } = req.body;
    const teacher = await Teacher.findByIdAndUpdate(req.params.id, { name, subject, mobile, photo }, { new: true });
    res.json({ teacher });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teachers/:id', async (req, res) => {
  await Teacher.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ================= Students Routes =================
app.get('/api/institutions/:code/students', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const [students, attempts] = await Promise.all([
    Student.find({ institutionCode: code }).sort({ createdAt: 1 }),
    Attempt.find({ institutionCode: code, postSubmitted: true })
  ]);
  const counts = {};
  attempts.forEach(a => {
    const k = String(a.studentId);
    counts[k] = (counts[k] || 0) + 1;
  });
  res.json({
    students: students.map(s => ({ ...s.toObject(), testsCompleted: counts[String(s._id)] || 0 }))
  });
});

app.post('/api/institutions/:code/students/bulk', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { lines } = req.body; // raw string or array of { name, className }
    const rows = Array.isArray(lines)
      ? lines
      : String(lines || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
          const [name, ...rest] = l.split(',');
          return { name: (name || '').trim(), className: rest.join(',').trim() };
        });

    const created = [];
    for (const row of rows) {
      if (!row.name) continue;
      const uniqueId = await generateUniqueStudentId();
      const s = await Student.create({
        institutionCode: code,
        uniqueId,
        name: row.name,
        className: row.className || ''
      });
      created.push(s);
    }
    res.status(201).json({ students: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/students/:id', async (req, res) => {
  try {
    const { name, className, photo } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (className !== undefined) update.className = className;
    if (photo !== undefined) update.photo = photo;
    const student = await Student.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ student });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/students/:id/reset', async (req, res) => {
  await Attempt.deleteMany({ studentId: req.params.id });
  await Submission.deleteMany({ studentId: req.params.id });
  res.json({ ok: true });
});

app.delete('/api/students/:id', async (req, res) => {
  await Attempt.deleteMany({ studentId: req.params.id });
  await Submission.deleteMany({ studentId: req.params.id });
  await Student.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ================= Courses Routes =================
app.get('/api/institutions/:code/courses', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const courses = await Course.find({ institutionCode: code }).sort({ createdAt: -1 });
  res.json({ courses });
});

app.post('/api/institutions/:code/courses', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const course = await Course.create({ ...req.body, institutionCode: code });
    res.status(201).json({ course });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/courses/:id', async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ course });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/courses/:id/reset', async (req, res) => {
  await Attempt.deleteMany({ courseId: req.params.id });
  await Submission.deleteMany({ courseId: req.params.id });
  res.json({ ok: true });
});

app.delete('/api/courses/:id', async (req, res) => {
  await Attempt.deleteMany({ courseId: req.params.id });
  await Submission.deleteMany({ courseId: req.params.id });
  await Course.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ================= Student Learning & Submissions Routes =================
app.get('/api/student/:studentId/dashboard', async (req, res) => {
  try {
    const student = await Student.findById(req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const [courses, attempts, submissions] = await Promise.all([
      Course.find({ institutionCode: student.institutionCode }).sort({ createdAt: 1 }),
      Attempt.find({ studentId: student._id }),
      Submission.find({ studentId: student._id })
    ]);

    res.json({ student, courses, attempts, submissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/attempts/pre-test', async (req, res) => {
  try {
    const { courseId, studentId, answers } = req.body;
    const course = await Course.findById(courseId);
    const student = await Student.findById(studentId);
    if (!course || !student) return res.status(404).json({ error: 'Course or student not found' });

    const total = course.quiz.length || 1;
    let correct = 0;
    course.quiz.forEach((q, idx) => {
      if (Number(answers[idx]) === Number(q.correctIndex)) correct++;
    });
    const preScore = Math.round((correct / total) * 100);

    const attempt = await Attempt.findOneAndUpdate(
      { courseId, studentId },
      {
        institutionCode: course.institutionCode,
        courseId,
        studentId,
        preSubmitted: true,
        preAnswers: answers,
        preScore,
        preSubmittedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.json({ attempt, correctCount: correct, totalCount: total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/attempts/post-test', async (req, res) => {
  try {
    const { courseId, studentId, answers } = req.body;
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const total = course.quiz.length || 1;
    let correct = 0;
    course.quiz.forEach((q, idx) => {
      if (Number(answers[idx]) === Number(q.correctIndex)) correct++;
    });
    const postScore = Math.round((correct / total) * 100);

    const attempt = await Attempt.findOneAndUpdate(
      { courseId, studentId },
      {
        postSubmitted: true,
        postAnswers: answers,
        postScore,
        postSubmittedAt: new Date()
      },
      { new: true }
    );

    res.json({ attempt, correctCount: correct, totalCount: total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/submissions', async (req, res) => {
  try {
    const { courseId, studentId, answer } = req.body;
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const submission = await Submission.findOneAndUpdate(
      { courseId, studentId },
      {
        institutionCode: course.institutionCode,
        courseId,
        studentId,
        answer,
        submittedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.json({ submission });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/institutions/:code/submissions', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const submissions = await Submission.find({ institutionCode: code })
    .populate('studentId', 'name className uniqueId')
    .populate('courseId', 'title subject')
    .sort({ submittedAt: -1 });
  res.json({ submissions });
});

app.put('/api/submissions/:id/feedback', async (req, res) => {
  const submission = await Submission.findByIdAndUpdate(
    req.params.id,
    { feedback: req.body.feedback || '' },
    { new: true }
  );
  res.json({ submission });
});

app.delete('/api/submissions/:id', async (req, res) => {
  await Submission.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ================= Analytics Route =================
app.get('/api/institutions/:code/analytics', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const [institution, teachers, students, courses, attempts, submissions] = await Promise.all([
      Institution.findOne({ code }),
      Teacher.find({ institutionCode: code }),
      Student.find({ institutionCode: code }),
      Course.find({ institutionCode: code }),
      Attempt.find({ institutionCode: code }),
      Submission.find({ institutionCode: code })
    ]);

    const completedAttempts = attempts.filter(a => a.postSubmitted);
    const totalMeasured = completedAttempts.length;
    const avgPre = totalMeasured
      ? Math.round(completedAttempts.reduce((s, a) => s + a.preScore, 0) / totalMeasured)
      : 0;
    const avgPost = totalMeasured
      ? Math.round(completedAttempts.reduce((s, a) => s + a.postScore, 0) / totalMeasured)
      : 0;
    const metrics = totalMeasured
      ? calcGrowthMetrics(avgPre, avgPost)
      : { gain: 0, growthRate: 0, normGain: 0, normLevel: 'Low' };

    res.json({
      institution,
      teachers,
      students,
      courses,
      attempts,
      submissions,
      summary: {
        studentCount: students.length,
        courseCount: courses.length,
        measuredCount: totalMeasured,
        avgPre,
        avgPost,
        ...metrics
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= AI Course Generator & Study Helper =================
app.post('/api/ai/generate-course', async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ error: 'Topic is required' });

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            messages: [{
              role: 'user',
              content: `Create a school course JSON for the topic "${topic}". Return ONLY valid JSON with keys: title, subject, summary, studyMaterial (use ## Heading for sections and blank lines between paragraphs), quizLines (5 lines, each formatted strictly as: Question | Option A | Option B | Option C | Option D | 1-4), assignmentTitle, assignmentTask.`
            }]
          })
        });
        const data = await aiRes.json();
        const text = data?.content?.[0]?.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return res.json(JSON.parse(jsonMatch[0]));
        }
      } catch (e) {
        console.warn('Claude API fallback triggered:', e.message);
      }
    }

    // Built-in intelligent fallback so demo works immediately without an API key
    const lower = topic.toLowerCase();
    if (lower.includes('photosynthesis')) {
      return res.json({
        title: 'Photosynthesis',
        subject: 'Science',
        summary: 'How plants make food using sunlight',
        studyMaterial: [
          '## What is photosynthesis?',
          'Photosynthesis is the process by which green plants use sunlight, water and carbon dioxide to make glucose and release oxygen.',
          '## Where does it happen?',
          'It takes place in chloroplasts, which contain the green pigment chlorophyll that captures light energy.',
          '## The simple equation',
          'Carbon dioxide + Water + Light energy → Glucose + Oxygen.'
        ].join('\n\n'),
        quizLines: [
          'Which gas do plants absorb for photosynthesis? | Oxygen | Carbon dioxide | Nitrogen | Hydrogen | 2',
          'Where does photosynthesis mainly occur in a cell? | Nucleus | Mitochondria | Chloroplast | Ribosome | 3',
          'Which pigment captures sunlight? | Chlorophyll | Melanin | Keratin | Haemoglobin | 1',
          'Which gas is released as a by-product? | Carbon dioxide | Methane | Oxygen | Helium | 3',
          'What sugar do plants make? | Sucrose only | Glucose | Lactose | Fructose only | 2'
        ].join('\n'),
        assignmentTitle: 'Assignment - Real life',
        assignmentTask: 'In 4-5 sentences, explain why a plant would die if kept in a dark cupboard for two weeks.'
      });
    }

    const cleanTopic = topic.split(',')[0].trim();
    return res.json({
      title: cleanTopic,
      subject: 'General Studies',
      summary: `Core concepts and real-world applications of ${cleanTopic}`,
      studyMaterial: [
        `## Introduction to ${cleanTopic}`,
        `${cleanTopic} is a foundational concept that helps learners connect theory with everyday observations.`,
        '## Key Principles',
        `Understanding how ${cleanTopic} works requires breaking the idea into cause, mechanism, and observable outcome.`,
        '## Summary',
        `Review the core definitions and practice applying ${cleanTopic} to real-life examples before taking the post-test.`
      ].join('\n\n'),
      quizLines: [
        `What is the primary focus when studying ${cleanTopic}? | Memorizing dates | Understanding core principles | Guessing outcomes | Avoiding examples | 2`,
        `Which approach helps master ${cleanTopic}? | Linking theory to real-life examples | Skipping foundational concepts | Ignoring feedback | Reading once without review | 1`,
        `When analyzing ${cleanTopic}, what should you identify first? | Random facts | Unrelated topics | Core cause and mechanism | Only the final page | 3`,
        `Why do pre-tests and post-tests help measure ${cleanTopic}? | They prove learning gain | They remove study material | They hide mistakes | They replace reading | 1`,
        `What makes an explanation of ${cleanTopic} complete? | No reasoning | Clear concepts and real-world application | Single-word answers | Unverified guesses | 2`
      ].join('\n'),
      assignmentTitle: 'Assignment - Real life',
      assignmentTask: `In 4-5 sentences, explain how ${cleanTopic} applies to a real-world situation you have observed.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/ask', async (req, res) => {
  try {
    const { question, context } = req.body;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            messages: [{
              role: 'user',
              content: `You are SikshaLite's helpful study and teaching assistant. Context: ${context || 'General platform help'}.\n\nUser question: ${question}`
            }]
          })
        });
        const data = await aiRes.json();
        const answer = data?.content?.[0]?.text;
        if (answer) return res.json({ answer });
      } catch (e) {
        console.warn('Ask Claude fallback:', e.message);
      }
    }

    res.json({
      answer: `Here is a quick tip on "${question}": Focus on comparing pre-test and post-test scores alongside normalized gain ((post - pre) / (100 - pre)) to measure true conceptual improvement.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve index.html for root
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SikshaLite server running on port ${PORT}`);
});
