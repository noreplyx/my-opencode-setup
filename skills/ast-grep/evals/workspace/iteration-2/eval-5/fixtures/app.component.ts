import { Component } from '@angular/core';
import { UserService } from '../../core/services/user.service';
import { Logger } from '../../shared/logger';
import { formatDate } from '../../common/utils/date-utils';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  title = 'test-app';

  constructor(
    private userService: UserService,
    private logger: Logger
  ) {}

  ngOnInit(): void {
    this.logger.info('App initialized');
    this.userService.loadUsers();
    const today = formatDate(new Date());
    console.log('Today is', today);
  }
}
