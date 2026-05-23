import { Component, OnInit } from '@angular/core';
import { AnalyticsService } from '../../core/analytics.service';
import { DashboardWidget } from '../../shared/widgets/dashboard-widget';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  widgets: DashboardWidget[] = [];

  constructor(private analytics: AnalyticsService) {}

  ngOnInit(): void {
    this.analytics.trackPageView('dashboard');
  }
}
