import FieldCanvas from '../components/FieldCanvas';
import './FieldPage.css';

export default function FieldPage() {
  return (
    <div className="field-page">
      <div className="field-page-canvas">
        <FieldCanvas variant="full" />
      </div>
      <div className="field-page-info">
        <p className="section-title">Field map</p>
        <p className="field-page-hint">
          Bird&apos;s-eye 3D view · Drag to pan · Scroll to zoom · Click a device to inspect. Ground uses a subtle
          live pattern (no orbit — top-down only).
        </p>
      </div>
    </div>
  );
}
