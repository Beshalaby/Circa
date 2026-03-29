import './CircaLogo.css';

interface Props {
  className?: string;
}

export default function CircaLogo({ className }: Props) {
  return (
    <span className={`circa-logo${className ? ` ${className}` : ''}`}>
      <span>Circa</span>
    </span>
  );
}
