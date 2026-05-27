import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-privacy-policy',
  templateUrl: './privacy-policy.component.html',
  styleUrls: ['./privacy-policy.component.css'],
  host: {
    class: 'fill-screen'
  }
})
export class PrivacyPolicyComponent {
  constructor(
    private router: Router
  ) { }

  navigateHome() {
    this.router.navigate(['/']);
  }

  openWhatsApp() {
    const phoneNumber = '97233746962';
    const message = encodeURIComponent('Privacy-Policy-At-Eazix');
    const url = `https://wa.me/${phoneNumber}?text=${message}`;
    window.open(url, '_blank');
  }

  totalAmountOfIndexes: number = 51;
  PpTitleIndexes: number[] = [
    2,  // הסכמה
    4,  // הבסיס המשפטי והמסגרת הנורמטיבית
    6,  // המידע שאנו אוספים
    12, // תשלומים וסליקה
    15, // שימוש במידע
    22, // קבצים ותמונות שמועלים להדפסה
    26, // ספקי צד שלישי
    31, // מסירת מידע לצדדים שלישיים
    34, // עוגיות (Cookies) וטכנולוגיות דומות
    36, // אבטחת מידע
    38, // שמירת מידע (Retention)
    42, // דיוור שיווקי (חוק הספאם)
    44, // זכויותיך ביחס למידע
    48, // קטינים
    50  // פניות בנושא פרטיות
  ];


  getPPArray() {
    let PPArray: any[] = [];
    for (let i = 0; i <= this.totalAmountOfIndexes; i++) {
      if (this.PpTitleIndexes.includes(i)) {
        PPArray.push(true);
      } else {
        PPArray.push(false);
      }
    }
    return PPArray;
  }
}


