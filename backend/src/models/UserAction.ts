import mongoose from 'mongoose';
import { UserAction } from '@/types';

const userActionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  movieId: {
    type: Number,
    required: true,
    index: true
  },
  actionType: {
    type: String,
    required: true,
    enum: ['click', 'view', 'rate', 'watchTime', 'addToWatchlist', 'removeFromWatchlist']
  },
  value: {
    type: Number,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  sessionId: {
    type: String,
    index: true
  },
  metadata: {
    duration: Number,
    position: Number,
    deviceType: String,
    source: String,
    serverTimestamp: String
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
userActionSchema.index({ userId: 1, timestamp: -1 });
userActionSchema.index({ movieId: 1, actionType: 1 });
userActionSchema.index({ userId: 1, actionType: 1, timestamp: -1 });

export const UserActionModel = mongoose.model<UserAction & mongoose.Document>('UserAction', userActionSchema);