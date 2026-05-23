import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ConfigService } from '../../common/config.service';
import { TokenManager } from '../../core/auth/token-manager';
import { Observable, of } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  constructor(
    private http: HttpClient,
    private config: ConfigService,
    private tokenManager: TokenManager
  ) {}

  login(username: string, password: string): Observable<boolean> {
    // This is a relative import test file — not production code
    return of(true);
  }
}
