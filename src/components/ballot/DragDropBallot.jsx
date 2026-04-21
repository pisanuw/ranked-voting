import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export default function DragDropBallot({ items, onChange }) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex(i => i.id === active.id)
      const newIndex = items.findIndex(i => i.id === over.id)
      onChange(arrayMove(items, oldIndex, newIndex))
    }
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">Your Ranking</p>
        <p className="text-xs text-slate-400">Drag to reorder · top = most preferred</p>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-slate-100">
            {items.map((item, index) => (
              <SortableItem key={item.id} item={item} rank={index + 1} total={items.length} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableItem({ item, rank, total }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const rankColor = rank === 1
    ? 'bg-brand-600 text-white'
    : rank === 2
    ? 'bg-brand-500 text-white'
    : rank === 3
    ? 'bg-brand-400 text-white'
    : 'bg-slate-200 text-slate-600'

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-4 py-3 select-none bg-white transition-shadow ${
        isDragging ? 'shadow-lg z-10 relative' : ''
      }`}
    >
      {/* Rank badge */}
      <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${rankColor}`}>
        {rank}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{item.title}</p>
        {item.description && <p className="text-xs text-slate-400 truncate">{item.description}</p>}
      </div>

      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="flex-shrink-0 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing p-1 touch-none"
        aria-label="Drag to reorder"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 8h16M4 16h16" />
        </svg>
      </button>
    </li>
  )
}
