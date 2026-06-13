import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PhPrint3dPreviewComponent } from './ph-print-3d-preview.component';
import {
  getTuningValue,
  PH_PRINT_3D_TUNING_FIELDS,
  PH_PRINT_3D_TUNING_GROUPS,
  PhPrint3dTuningField,
  setTuningValue,
} from './ph-print-3d-preview-tuning.model';

@Component({
  selector: 'app-ph-print-3d-preview-tunings',
  templateUrl: './ph-print-3d-preview-tunings.component.html',
  styleUrls: ['./ph-print-3d-preview-tunings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhPrint3dPreviewTuningsComponent implements OnChanges, AfterViewInit {
  @Input() preview?: PhPrint3dPreviewComponent;

  readonly groups = PH_PRINT_3D_TUNING_GROUPS;
  readonly fields = PH_PRINT_3D_TUNING_FIELDS;

  collapsed = false;
  copyState: 'idle' | 'ok' | 'error' = 'idle';

  ready = false;

  constructor(
    private cdr: ChangeDetectorRef,
    private snackBar: MatSnackBar,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['preview']) {
      this.ready = !!this.preview;
      this.cdr.markForCheck();
    }
  }

  ngAfterViewInit(): void {
    this.ready = !!this.preview;
    this.cdr.markForCheck();
  }

  fieldsForGroup(group: string): PhPrint3dTuningField[] {
    return this.fields.filter((field) => field.group === group);
  }

  fieldValue(field: PhPrint3dTuningField): string | number {
    if (!this.preview) {
      return field.type === 'color' ? '#ffffff' : 0;
    }
    const value = getTuningValue(this.preview.getMutableTuningRoots(), field.path);
    if (field.type === 'color') {
      return typeof value === 'string' ? value : '#ffffff';
    }
    if (field.type === 'select') {
      return typeof value === 'string' ? value : field.options?.[0]?.value ?? '';
    }
    return typeof value === 'number' ? value : Number(value) || 0;
  }

  onFieldInput(field: PhPrint3dTuningField, raw: string | number): void {
    if (!this.preview) {
      return;
    }
    let value: unknown = raw;
    if (field.type === 'number') {
      value = Number(raw);
      if (!Number.isFinite(value as number)) {
        return;
      }
    }
    setTuningValue(this.preview.getMutableTuningRoots(), field.path, value);
    void this.preview.applyRuntimeTunings(field.path.startsWith('camera.'));
    this.cdr.markForCheck();
  }

  async copySnapshot(): Promise<void> {
    if (!this.preview) {
      return;
    }
    const text = JSON.stringify(this.preview.getTuningSnapshot(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      this.copyState = 'ok';
      this.snackBar.open('הנתונים הועתקו ללוח', '', { duration: 2200 });
    } catch {
      this.copyState = 'error';
      this.snackBar.open('לא הצלחנו להעתיק — נסה שוב', '', { duration: 2600 });
    }
    this.cdr.markForCheck();
    window.setTimeout(() => {
      this.copyState = 'idle';
      this.cdr.markForCheck();
    }, 2400);
  }

  resetToDefaults(): void {
    this.preview?.resetTuningsToDefaults();
    this.cdr.markForCheck();
  }

  toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.cdr.markForCheck();
  }
}
