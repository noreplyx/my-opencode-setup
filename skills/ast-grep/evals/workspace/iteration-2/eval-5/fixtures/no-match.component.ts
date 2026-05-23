import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormBuilder, Validators } from '@angular/forms';

@Component({
  selector: 'app-no-match',
  templateUrl: './no-match.component.html',
})
export class NoMatchComponent {
  constructor(
    private router: Router,
    private snackBar: MatSnackBar,
    private fb: FormBuilder
  ) {}
}
