import { Icon } from '@shared/icons/Icon.jsx';

const DESTINATIONS = Object.freeze([
  { id: 'tasks', label: 'Today', icon: 'tasks' },
  { id: 'goals', label: 'Goals', icon: 'events' },
  { id: 'chronicle', label: 'Chronicle', icon: 'feed' },
  { id: 'shop', label: 'Shop', icon: 'shop' },
  { id: 'profile', label: 'More', icon: 'profile' },
]);

export default function MobileBottomNavigation({ value, onChange }) {
  return (
    <nav className="mobile-bottom-navigation" aria-label="Mobile destinations">
      {DESTINATIONS.map((destination) => (
        <button
          key={destination.id}
          type="button"
          className={value === destination.id ? 'is-active' : ''}
          aria-current={value === destination.id ? 'page' : undefined}
          onClick={() => onChange(destination.id)}
        >
          <Icon name={destination.icon} size={19} />
          <span>{destination.label}</span>
        </button>
      ))}
    </nav>
  );
}
