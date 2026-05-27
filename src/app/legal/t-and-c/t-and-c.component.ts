import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-t-and-c',
  templateUrl: './t-and-c.component.html',
  styleUrls: ['./t-and-c.component.css'],
  host: {
    class: 'fill-screen'
  }
})

export class TAndCComponent {
  constructor(
    private router: Router
  ) { }

  navigateHome() {
    this.router.navigate(['/']);
  }

  openWhatsApp() {
    const phoneNumber = '97233746962';
    const message = encodeURIComponent('T_And_C-At-Eazix');
    const url = `https://wa.me/${phoneNumber}?text=${message}`;
    window.open(url, '_blank');
  }

  totalAmountOfIndexes: number = 57;
  TandCTitleIndexes: number[] = [
    3,  // השירותים
    5,  // הרשמה ושימוש
    7,  // תשלומים
    11, // חומרים ותוכן להדפסה
    16, // שמירת קבצים
    21, // איסוף ומשלוח
    26, // זמני הדפסה
    28, // ביטולים והחזרים
    32, // נגישות
    34, // שימושים אסורים באתר
    36, // קניין רוחני
    38, // אחריות לדיוק המידע באתר
    40, // הגבלת אחריות
    44, // אחריות לפעילות בלתי חוקית של צד שלישי
    46, // שיפוי
    48, // צעדים מיידיים בהפרת תנאים
    50, // קישורים ופרסומות של צדדים שלישיים
    52, // שינויים בתנאים
    54, // הדין וסמכות השיפוט
    56  // שירות לקוחות
  ];

  getTandCArray() {
    let TandCArray: any[] = [];
    for (let i = 0; i <= this.totalAmountOfIndexes; i++) {
      if (this.TandCTitleIndexes.includes(i)) {
        TandCArray.push(true);
      } else {
        TandCArray.push(false);
      }
    }
    return TandCArray;
  }
}
