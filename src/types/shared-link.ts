import { type Chat } from './chat';

export type SharedLink = {
  id: string;
  chat?: Chat;
  createdAt: Date;
};
