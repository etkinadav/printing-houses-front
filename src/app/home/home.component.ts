import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';

/** Forward / reverse playback speed multiplier (0.5 = half speed). */
const PLAYBACK_SPEED = 0.5;

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  host: {
    class: 'fill-screen',
  },
})
export class HomeComponent implements AfterViewInit, OnDestroy {
  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;

  private playingReverse = false;
  private reverseRafId: number | null = null;
  private lastReverseTs: number | null = null;

  ngAfterViewInit(): void {
    const video = this.videoRef.nativeElement;
    video.playbackRate = PLAYBACK_SPEED;
    void video.play().catch(() => {
      // Autoplay may be blocked until user gesture; retry on first interaction.
      const resume = () => {
        video.playbackRate = PLAYBACK_SPEED;
        void video.play();
        document.removeEventListener('pointerdown', resume);
        document.removeEventListener('keydown', resume);
      };
      document.addEventListener('pointerdown', resume, { once: true });
      document.addEventListener('keydown', resume, { once: true });
    });
  }

  ngOnDestroy(): void {
    this.stopReverse();
  }

  onVideoEnded(): void {
    if (this.playingReverse) {
      return;
    }
    this.startReverse();
  }

  private startReverse(): void {
    const video = this.videoRef?.nativeElement;
    if (!video) {
      return;
    }

    video.pause();
    this.playingReverse = true;
    this.lastReverseTs = null;
    this.reverseRafId = requestAnimationFrame(this.reverseStep);
  }

  private readonly reverseStep = (ts: number): void => {
    const video = this.videoRef?.nativeElement;
    if (!video || !this.playingReverse) {
      return;
    }

    if (this.lastReverseTs == null) {
      this.lastReverseTs = ts;
      this.reverseRafId = requestAnimationFrame(this.reverseStep);
      return;
    }

    const deltaSec = (ts - this.lastReverseTs) / 1000;
    this.lastReverseTs = ts;
    video.currentTime = Math.max(0, video.currentTime - deltaSec * PLAYBACK_SPEED);

    if (video.currentTime <= 0.01) {
      this.stopReverse();
      video.currentTime = 0;
      video.playbackRate = PLAYBACK_SPEED;
      void video.play();
      return;
    }

    this.reverseRafId = requestAnimationFrame(this.reverseStep);
  };

  private stopReverse(): void {
    this.playingReverse = false;
    this.lastReverseTs = null;
    if (this.reverseRafId != null) {
      cancelAnimationFrame(this.reverseRafId);
      this.reverseRafId = null;
    }
  }
}
