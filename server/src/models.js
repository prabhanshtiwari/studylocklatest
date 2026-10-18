import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const privacySchema = new Schema({
  profileVisibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public' },
  showOnLeaderboard: { type: Boolean, default: false },
  showStudyStats: { type: Boolean, default: false },
  allowFriendRequests: { type: Boolean, default: true },
  allowMessages: { type: String, enum: ['friends', 'none'], default: 'friends' }
}, { _id: false });

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254, select: false },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 24, match: /^[a-z0-9_]+$/ },
  displayName: { type: String, required: true, trim: true, maxlength: 60 },
  phoneNumber: { type: String, required: true, trim: true, maxlength: 20, default: '' },
  // Private payout destination. Never include this in public profile serializers.
  upiId: { type: String, trim: true, maxlength: 120, default: '', select: false },
  quickLinks: { type: [{ label: { type: String, trim: true, maxlength: 30 }, url: { type: String, trim: true, maxlength: 500 }, icon: { type: String, trim: true, maxlength: 12 } }], default: [] },
  quickLinksConfigured: { type: Boolean, default: false },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  tokenVersion: { type: Number, default: 0, min: 0 },
  suspended: { type: Boolean, default: false },
  suspensionReason: { type: String, default: '', maxlength: 300 },
  emailVerified: { type: Boolean, default: false },
  emailVerificationTokenHash: { type: String, select: false },
  emailVerificationExpiresAt: { type: Date, select: false },
  passwordResetTokenHash: { type: String, select: false },
  passwordResetExpiresAt: { type: Date, select: false },
  bio: { type: String, default: '', maxlength: 400 },
  avatarUrl: { type: String, default: '', maxlength: 500 },
  interests: { type: [String], default: [] },
  learningGoals: { type: [String], default: [] },
  privacy: { type: privacySchema, default: () => ({}) },
  friends: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  blockedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  achievements: { type: [String], default: [] },
  lastActiveAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true, versionKey: false });
userSchema.index({ 'privacy.showOnLeaderboard': 1 });

const studyEventSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  eventId: { type: String, required: true, maxlength: 100 },
  sessionId: { type: String, default: '', maxlength: 100 },
  videoId: { type: String, default: '', maxlength: 30 },
  videoTitle: { type: String, default: 'YouTube lesson', maxlength: 180 },
  subject: { type: String, default: 'general', maxlength: 50, index: true },
  qualifyingSeconds: { type: Number, default: 0, min: 0, max: 120 },
  coverageSeconds: { type: Number, default: 0, min: 0, max: 120 },
  completed: { type: Boolean, default: false },
  eventAt: { type: Date, default: Date.now, index: true },
  receivedAt: { type: Date, default: Date.now }
}, { versionKey: false });
studyEventSchema.index({ userId: 1, eventId: 1 }, { unique: true });
studyEventSchema.index({ eventAt: -1, subject: 1 });
studyEventSchema.index({ userId: 1, eventAt: 1 });
studyEventSchema.index({ subject: 1, eventAt: 1 });

const friendRequestSchema = new Schema({
  fromUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  toUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  respondedAt: Date
}, { versionKey: false });
friendRequestSchema.index({ fromUserId: 1, toUserId: 1 }, { unique: true });
friendRequestSchema.index({ toUserId: 1, status: 1, createdAt: -1 });

const messageSchema = new Schema({
  senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now },
  readAt: Date
}, { versionKey: false });
messageSchema.index({ senderId: 1, recipientId: 1, createdAt: -1 });
messageSchema.index({ recipientId: 1, createdAt: -1 });

const reportSchema = new Schema({
  reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  targetType: { type: String, enum: ['user', 'message', 'challenge'], required: true },
  targetId: { type: String, required: true, maxlength: 100 },
  reason: { type: String, enum: ['spam', 'harassment', 'inappropriate', 'impersonation', 'other'], required: true },
  details: { type: String, default: '', maxlength: 1000 },
  status: { type: String, enum: ['open', 'reviewed', 'actioned', 'dismissed'], default: 'open' },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });
reportSchema.index({ createdAt: -1, status: 1 });

const participantSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  progress: { type: Number, default: 0, min: 0 },
  joinedAt: { type: Date, default: Date.now },
  completedAt: Date
}, { _id: false });
const challengeSchema = new Schema({
  creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, default: '', maxlength: 500 },
  type: { type: String, enum: ['study_minutes', 'lessons', 'streak'], default: 'study_minutes' },
  goal: { type: Number, required: true, min: 1, max: 100000 },
  startsAt: { type: Date, default: Date.now },
  endsAt: { type: Date, required: true },
  visibility: { type: String, enum: ['public', 'friends'], default: 'public' },
  participants: { type: [participantSchema], default: [] },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true, versionKey: false });
challengeSchema.index({ visibility: 1, endsAt: 1, createdAt: -1 });

export const User = model('User', userSchema);
export const StudyEvent = model('StudyEvent', studyEventSchema);
export const FriendRequest = model('FriendRequest', friendRequestSchema);
export const Message = model('Message', messageSchema);
export const Report = model('Report', reportSchema);
export const Challenge = model('Challenge', challengeSchema);


const quizQuestionSchema = new Schema({
  prompt: { type: String, required: true, trim: true, maxlength: 1000 },
  type: { type: String, enum: ['single_choice', 'multiple_choice', 'true_false', 'short_answer'], required: true },
  options: { type: [String], default: [], validate: v => v.length <= 12 },
  correctAnswers: { type: [String], required: true, default: [] },
  points: { type: Number, default: 1, min: 1, max: 100 },
  explanation: { type: String, default: '', maxlength: 1000 },
  timeLimitSeconds: { type: Number, default: 30, min: 5, max: 600 }
}, { _id: true, versionKey: false });

const quizSchema = new Schema({
  creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', maxlength: 1000 },
  startsAt: { type: Date, required: true, index: true },
  endsAt: { type: Date, required: true, index: true },
  durationMinutes: { type: Number, required: true, min: 1, max: 240 },
  maxParticipants: { type: Number, required: true, min: 1, max: 10000 },
  isPublished: { type: Boolean, default: false, index: true },
  questions: { type: [quizQuestionSchema], default: [], validate: v => v.length <= 100 },
  participantIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  resultsFinalizedAt: Date
}, { timestamps: true, versionKey: false });
quizSchema.index({ isPublished: 1, startsAt: 1, endsAt: 1 });

const quizAnswerSchema = new Schema({
  questionId: { type: Schema.Types.ObjectId, required: true },
  response: { type: [String], default: [] }
}, { _id: false, versionKey: false });

const quizAttemptSchema = new Schema({
  quizId: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  startedAt: { type: Date, required: true, default: Date.now },
  submittedAt: Date,
  elapsedSeconds: { type: Number, default: 0, min: 0 },
  answers: { type: [quizAnswerSchema], default: [] },
  score: { type: Number, default: 0, min: 0 },
  totalPoints: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['in_progress', 'submitted', 'timed_out', 'disqualified'], default: 'in_progress', index: true },
  prizeAwarded: { type: Boolean, default: false },
  prizeAmount: { type: Number, default: 0, min: 0, max: 100000000 },
  prizeNote: { type: String, default: '', maxlength: 300 },
  prizeReceived: { type: Boolean, default: false },
  prizeReceivedAt: Date,
  currentQuestionIndex: { type: Number, default: 0, min: 0 },
  questionStartedAt: { type: Date, default: Date.now },
  copyWarnings: { type: Number, default: 0, min: 0 },
  fullscreenViolations: { type: Number, default: 0, min: 0 },
  disqualifiedAt: Date,
  disqualificationReason: { type: String, default: '', maxlength: 300 }
}, { timestamps: true, versionKey: false });
quizAttemptSchema.index({ quizId: 1, userId: 1 }, { unique: true });
quizAttemptSchema.index({ quizId: 1, status: 1, score: -1, elapsedSeconds: 1, submittedAt: 1 });

export const Quiz = model('Quiz', quizSchema);
export const QuizAttempt = model('QuizAttempt', quizAttemptSchema);
