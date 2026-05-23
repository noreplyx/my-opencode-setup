// Sample TypeScript file for ast-grep testing

import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

interface User {
  id: number;
  name: string;
  email: string;
}

@Component({
  selector: 'app-user-list',
  templateUrl: './user-list.component.html',
})
export class UserListComponent implements OnInit {
  users: User[] = [];
  loading = false;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  loadUsers(): void {
    this.loading = true;
    this.http.get<User[]>('/api/users').subscribe({
      next: (data) => {
        this.users = data;
        this.loading = false;
      },
      error: (err) => {
        this.logger.error('Failed to load users:', err);
        this.loading = false;
      },
    });
  }

  getUserName(id: number): string | undefined {
    const user = this.users.find((u) => u.id === id);
    return user?.name;
  }

  deleteUser(id: number): void {
    const confirmed = confirm(`Delete user ${id}?`);
    if (confirmed) {
      this.http.delete(`/api/users/${id}`).subscribe(() => {
        this.users = this.users.filter((u) => u.id !== id);
      });
    }
  }

  private validateEmail(email: string): boolean {
    // Basic validation
    if (!email || !email.includes('@')) {
      return false;
    }
    const [local, domain] = email.split('@');
    if (!local || !domain) {
      return false;
    }
    return true;
  }
}
