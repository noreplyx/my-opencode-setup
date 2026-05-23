// Sample TypeScript file for ast-grep codemod testing
// Contains various patterns for structural search/rewrite evals

import { Component, Input, Output, EventEmitter } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

// --- Arrow functions for eval 4 (kind vs pattern) ---
const add = (a: number, b: number) => a + b;
const greet = (name: string) => `Hello, ${name}!`;
const multiply = (x: number, y: number) => {
  const result = x * y;
  return result;
};

// --- Multiple arrow functions with implicit returns ---
const double = (n: number) => n * 2;
const square = (n: number) => n ** 2;
const formatName = (first: string, last: string) => `${first} ${last}`.trim();

// --- Arrow functions with block bodies (should NOT match implicit return patterns) ---
const process = (items: number[]) => {
  return items.filter(n => n > 0).map(n => n * 2);
};
const handleError = (err: Error) => {
  console.error('Caught:', err.message);
  return null;
};

// --- Functions with console.log (for rewrite/testing) ---
function logUser(user: { id: number; name: string }) {
  console.info('User loaded:', user.id);
  console.log(user.name);
}

function processData(data: string) {
  console.debug('Processing:', data);
  return data.trim().toLowerCase();
}

// --- Class with event emitters and subscribe ---
@Component({ selector: 'app-data-view' })
export class DataViewerComponent {
  @Input() data: string[] = [];
  @Output() itemSelected = new EventEmitter<string>();

  private cache = new Map<string, any>();

  constructor(private http: HttpClient) {}

  loadItem(id: string) {
    if (this.cache.has(id)) {
      return of(this.cache.get(id));
    }
    return this.http.get(`/api/items/${id}`).pipe(
      map((response) => {
        this.cache.set(id, response);
        return response;
      }),
      catchError((err) => {
        console.error('Failed to load item:', err);
        return of(null);
      })
    );
  }

  selectItem(item: string) {
    this.itemSelected.emit(item);
  }

  // Method with subscribe (no pipe)
  saveData(data: any) {
    this.http.post('/api/data', data).subscribe({
      next: () => console.log('Saved successfully'),
      error: (err: Error) => console.error('Save failed:', err),
    });
  }
}
