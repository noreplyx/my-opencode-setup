import { z } from "zod";

export const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().min(18),
});

export interface User {
  id: string;
  name: string;
  email: string;
  age: number;
  createdAt: Date;
}

export class UserService {
  private users: Map<string, User> = new Map();

  async createUser(data: unknown): Promise<User> {
    try {
      const validated = CreateUserSchema.parse(data);
      const user: User = {
        id: crypto.randomUUID(),
        ...validated,
        createdAt: new Date(),
      };
      this.users.set(user.id, user);
      return user;
    } catch (error) {
      throw new Error(`Failed to create user: ${(error as Error).message}`);
    }
  }

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async listUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }
}

export function formatUserName(user: User): string {
  return `${user.name} <${user.email}>`;
}
