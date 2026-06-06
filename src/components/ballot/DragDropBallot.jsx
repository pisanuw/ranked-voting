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

export default function DragDropBallot({ items, onChange, comments, onCommentChange, commentsRequired = false }) {
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
              <SortableItem
                key={item.id}
                item={item}
                rank={index + 1}
                total={items.length}
                comment={comments?.[item.id] ?? ''}
                onCommentChange={onCommentChange}
                commentsRequired={commentsRequired}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableItem({ item, rank, total, comment, onCommentChange, commentsRequired }) {
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
      className={`px-4 py-3 select-none bg-white transition-shadow ${
        isDragging ? 'shadow-lg z-10 relative' : ''
      }`}
    >
      <div className="flex items-center gap-3">
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
      </div>

      {/* Comment input */}
      {onCommentChange && (() => {
        const missing = commentsRequired && !comment.trim()
        return (
          <div className="mt-2 ml-10">
            <textarea
              rows={2}
              maxLength={2000}
              className={`w-full text-sm border rounded px-2 py-1.5 text-slate-700 placeholder-slate-300 resize-y focus:outline-none focus:ring-1 ${
                missing
                  ? 'border-amber-300 focus:ring-amber-400'
                  : 'border-slate-200 focus:ring-brand-400'
              }`}
              placeholder={commentsRequired ? 'Comment required…' : 'Optional comment…'}
              value={comment}
              onChange={e => onCommentChange(item.id, e.target.value)}
            />
            {missing && (
              <p className="text-xs text-amber-600 mt-0.5">A comment is required for this option.</p>
            )}
          </div>
        )
      })()}
    </li>
  )
}
