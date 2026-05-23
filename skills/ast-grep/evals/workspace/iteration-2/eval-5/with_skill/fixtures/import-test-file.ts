// Fixture file for testing ast-grep import search
// Contains imports from ../../core, ../../shared, and ../../common

import { Injectable } from '@angular/core';
import { UserService } from '../../core/user.service';
import { formatDate } from '../../shared/utils/date-utils';
import { API_BASE_URL } from '../../common/constants';
import { AuthGuard } from '../../core/guards/auth.guard';
import { Logger } from '../../shared/logger';
import { HttpClient } from '@angular/common/http';
import { PaginationModel } from '../../common/models/pagination';
import { DashboardComponent } from '../dashboard/dashboard.component';
