
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';
import { GoogleGenAI, Type } from "@google/genai";

// --- TYPE DEFINITIONS ---
type ShiftTime = string;
type ViewMode = 'month' | 'week' | 'day';
type UserRole = 'admin' | 'user';

interface Specialty {
  name: string;
  color: string;
}

interface Doctor {
  id: string;
  name: string; // Apellidos y Nombres
  specialty: string; // Servicio
  dni: string;
  cargo: string;
  condicionLaboral: string;
}

interface User {
  id: string;
  username: string;
  password: string; // In a real app, this should be a hash
  role: UserRole;
  specialty?: string; // Required if role is 'user'
}

interface Shift {
  id: string;
  doctorId: string;
  date: string; // YYYY-MM-DD
  time: ShiftTime;
}

interface CustomShift {
    id: string;
    name: string;
    abbreviation: string;
    startTime: string; // HH:mm
    endTime: string; // HH:mm
    duration: number; // in hours
    color: string;
    specialtyName: string;
}

interface ShiftInfo {
    name: string;
    abbreviation: string;
    duration: number;
    startTime?: string;
    endTime?: string;
}

interface ModalState {
  isOpen: boolean;
  mode: 'new' | 'edit';
  date?: string;
  shift?: Shift;
  prefilledDoctorId?: string;
  prefilledTime?: ShiftTime;
}

// --- CONSTANTS & TRANSLATIONS ---
const MIN_HOURS = 120;
const MAX_HOURS_WARNING = 140;
const MAX_HOURS_CRITICAL = 150;
const MAX_WEEKLY_HOURS = 36;

const defaultShifts: Record<string, { translation: string; abbreviation: string; duration: number; startTime?: string; endTime?: string; }> = {
  Morning: { translation: 'M (Mañana) 07:00-13:00', abbreviation: 'M', duration: 6, startTime: '07:00', endTime: '13:00' },
  Afternoon: { translation: 'T (Tarde) 13:00-19:00', abbreviation: 'T', duration: 6, startTime: '13:00', endTime: '19:00' },
  MorningAfternoon: { translation: 'MT (Mañana y Tarde) 07:00-19:00', abbreviation: 'MT', duration: 12, startTime: '07:00', endTime: '19:00' },
  Night: { translation: 'N (Noche) 19:00-07:00', abbreviation: 'N', duration: 12, startTime: '19:00', endTime: '07:00' },
  DayGuard: { translation: 'GD (Guardia Diurna) 07:00-19:00', abbreviation: 'GD', duration: 12, startTime: '07:00', endTime: '19:00' },
  NightGuard: { translation: 'GN (Guardia Nocturna) 19:00-07:00', abbreviation: 'GN', duration: 12, startTime: '19:00', endTime: '07:00' },
  Vacation: { translation: 'V (Vacaciones)', abbreviation: 'V', duration: 0 },
};

const defaultShiftKeys = Object.keys(defaultShifts);

// --- INITIAL DATA & UTILS ---
const initialSpecialties: Specialty[] = [
    { name: 'Cardiología', color: '#0d6efd' },
    { name: 'Neurología', color: '#6f42c1' },
    { name: 'Pediatría', color: '#198754' },
    { name: 'Cirugía', color: '#dc3545' },
    { name: 'Emergencias', color: '#ffc107' },
];

const newSpecialtyColorPalette = [ '#fd7e14', '#20c997', '#6c757d', '#0dcaf0', '#d63384', '#800080', '#008080', '#ff6347'];

const initialDoctors: Doctor[] = [
  { id: 'doc1', name: 'Reed, Evelyn', specialty: 'Cardiología', dni: '12345678A', cargo: 'Médico Asistente', condicionLaboral: 'Nombrado' },
  { id: 'doc2', name: 'Thorne, Marcos', specialty: 'Neurología', dni: '23456789B', cargo: 'Jefe de Servicio', condicionLaboral: 'Nombrado' },
  { id: 'doc3', name: 'Petrova, Lena', specialty: 'Pediatría', dni: '34567890C', cargo: 'Médico Residente', condicionLaboral: 'Contratado' },
  { id: 'doc4', name: 'Tanaka, Kenji', specialty: 'Cirugía', dni: '45678901D', cargo: 'Cirujano Principal', condicionLaboral: 'Nombrado' },
  { id: 'doc5', name: 'Chen, Samuel', specialty: 'Emergencias', dni: '56789012E', cargo: 'Médico de Guardia', condicionLaboral: 'Contratado' },
];

const initialUsers: User[] = [
    { id: 'user_admin', username: 'admin', password: 'admin', role: 'admin' },
];

const initialShifts: Shift[] = [
 { id: 'shift1', doctorId: 'doc1', date: new Date().toISOString().slice(0, 8) + '05', time: 'DayGuard' },
  { id: 'shift2', doctorId: 'doc2', date: new Date().toISOString().slice(0, 8) + '05', time: 'DayGuard' },
  { id: 'shift3', doctorId: 'doc4', date: new Date().toISOString().slice(0, 8) + '07', time: 'NightGuard' },
  { id: 'shift4', doctorId: 'doc3', date: new Date().toISOString().slice(0, 8) + '12', time: 'DayGuard' },
  { id: 'shift5', doctorId: 'doc5', date: new Date().toISOString().slice(0, 8) + '12', time: 'NightGuard' },
];

const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
const getWeekDays = (currentDate: Date) => {
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - startOfWeek.getDay());
    return Array.from({length: 7}, (_, i) => {
        const day = new Date(startOfWeek);
        day.setDate(startOfWeek.getDate() + i);
        return day;
    });
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const formatDate = (date: Date) => date.toISOString().slice(0, 10);

// --- COMPONENTS ---

const LoginPage: React.FC<{
  onLogin: (username: string, password: string) => boolean;
}> = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!username || !password) {
            setError('Por favor, ingrese usuario y contraseña.');
            return;
        }
        const success = onLogin(username, password);
        if (!success) {
            setError('Usuario o contraseña incorrectos.');
        }
    };

    return (
        <div className="login-page">
            <div className="login-container">
                <h2>Iniciar Sesión</h2>
                <p>Gestor de Turnos Hospitalarios</p>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="username">Usuario</label>
                        <input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="e.g., admin"
                            autoFocus
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="password">Contraseña</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                        />
                    </div>
                    {error && <p className="error-message">{error}</p>}
                    <div className="form-actions">
                        <button type="submit" className="button-primary login-button">Acceder</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const Modal: React.FC<{ children: React.ReactNode; onClose: () => void; title: string }> = ({ children, onClose, title }) => (
  <div className="modal-backdrop" onClick={onClose}>
    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <h2>{title}</h2>
        <button onClick={onClose} className="close-button" aria-label="Cerrar modal">&times;</button>
      </div>
      <div className="modal-body">{children}</div>
    </div>
  </div>
);

const ShiftModal: React.FC<{
  modalState: ModalState;
  onClose: () => void;
  onSave: (shift: Omit<Shift, 'id'>, id?: string) => boolean;
  onDelete: (shiftId: string) => void;
  doctors: Doctor[];
  shifts: Shift[];
  specialties: Specialty[];
  doctorMonthlyHours: Map<string, number>;
  allShiftsMap: Map<string, ShiftInfo>;
  customShifts: CustomShift[];
}> = ({ modalState, onClose, onSave, onDelete, doctors, shifts, specialties, doctorMonthlyHours, allShiftsMap, customShifts }) => {
  const { mode, shift, date, prefilledDoctorId, prefilledTime } = modalState;
  const [doctorId, setDoctorId] = useState<string>(shift?.doctorId || prefilledDoctorId || doctors[0]?.id || '');
  const [time, setTime] = useState<ShiftTime>(shift?.time || prefilledTime || 'DayGuard');
  const [error, setError] = useState('');
  const [manualDate, setManualDate] = useState<string>(shift?.date || date || formatDate(new Date()));

  const specialtyMap = useMemo(() => new Map(specialties.map(s => [s.name, s])), [specialties]);
  const doctorsWithSpecialty = useMemo(() => doctors.map(d => ({...d, specialtyInfo: specialtyMap.get(d.specialty)})), [doctors, specialtyMap]);
  
  const selectedDoctor = useMemo(() => doctors.find(d => d.id === doctorId), [doctors, doctorId]);

  const availableCustomShifts = useMemo(() => {
    if (!selectedDoctor) return [];
    return customShifts.filter(cs => cs.specialtyName === selectedDoctor.specialty);
  }, [customShifts, selectedDoctor]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!doctorId) {
      setError('Por favor, seleccione un médico.');
      return;
    }

    const shiftDate = shift?.date || date || manualDate;
    
    const newShiftInfo = allShiftsMap.get(time);
    if (!newShiftInfo) return; // Should not happen
    
    const newShiftHours = newShiftInfo.duration || 0;

    // --- Weekly Hour Check ---
    const getWeekRangeForDate = (d: string) => {
        const dateObj = new Date(d);
        const dayOfWeek = dateObj.getUTCDay(); // Use UTC day to avoid timezone shifts
        const start = new Date(dateObj);
        start.setUTCDate(start.getUTCDate() - dayOfWeek);
        start.setUTCHours(0, 0, 0, 0);
        
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 6);
        end.setUTCHours(23, 59, 59, 999);
        return { start, end };
    };

    const { start, end } = getWeekRangeForDate(shiftDate);
    
    const weeklyShifts = shifts.filter(s => {
        const sDate = new Date(s.date);
        return s.doctorId === doctorId && s.id !== shift?.id && sDate >= start && sDate <= end;
    });

    const weeklyHoursWithoutCurrent = weeklyShifts.reduce((acc, s) => acc + (allShiftsMap.get(s.time)?.duration || 0), 0);
    const newWeeklyTotal = weeklyHoursWithoutCurrent + newShiftHours;
    
    if (newWeeklyTotal > MAX_WEEKLY_HOURS) {
        setError(`Al guardar, el médico tendrá ${newWeeklyTotal} horas esta semana, superando el máximo de ${MAX_WEEKLY_HOURS}.`);
        return;
    }

    // --- Monthly Hour Check ---
    const currentHours = doctorMonthlyHours.get(doctorId) || 0;
    const oldShiftHours = shift ? (allShiftsMap.get(shift.time)?.duration || 0) : 0;
    const newTotalHours = currentHours - oldShiftHours + newShiftHours;
    
    if (newTotalHours > MAX_HOURS_CRITICAL) {
        setError(`Al guardar, el médico tendrá ${newTotalHours} horas este mes, superando el máximo de ${MAX_HOURS_CRITICAL}.`);
        return;
    }

    // --- Advanced Conflict Detection ---

    // Rule 1: Vacation. A vacation day cannot have any other shifts.
    const isAddingVacation = time === 'Vacation';
    const hasOtherShiftsOnDay = shifts.some(s => s.id !== shift?.id && s.doctorId === doctorId && s.date === shiftDate);
    if (isAddingVacation && hasOtherShiftsOnDay) {
      setError('Este médico ya tiene otros turnos en esta fecha. No se puede asignar "Vacaciones".');
      return;
    }
    const hasVacationOnDay = shifts.some(s => s.id !== shift?.id && s.doctorId === doctorId && s.date === shiftDate && s.time === 'Vacation');
    if (!isAddingVacation && hasVacationOnDay) {
      setError('Este médico está de vacaciones en esta fecha. No se pueden agregar más turnos.');
      return;
    }

    // Rule 2: Post-NightGuard. Cannot work any shift the day after a night guard.
    const prevDate = new Date(shiftDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = formatDate(prevDate);
    if (shifts.some(s => s.doctorId === doctorId && s.date === prevDateStr && (s.time === 'NightGuard' || s.time === 'Night'))) {
      setError('No se puede asignar un turno el día después de una guardia nocturna.');
      return;
    }
    
    // Rule 3: Time Overlap. Shifts on the same day cannot overlap.
    if (newShiftInfo.startTime && newShiftInfo.endTime) {
        const timeToMinutes = (t: string) => t.split(':').map(Number).reduce((h, m) => h * 60 + m);
        
        let newStart = timeToMinutes(newShiftInfo.startTime);
        let newEnd = timeToMinutes(newShiftInfo.endTime);
        if (newEnd <= newStart) newEnd += 24 * 60; // Handle overnight shifts

        for (const s of shifts) {
            if (s.id === shift?.id || s.doctorId !== doctorId || s.date !== shiftDate) continue;

            const existingShiftInfo = allShiftsMap.get(s.time);
            if (!existingShiftInfo?.startTime || !existingShiftInfo?.endTime) continue;

            let existingStart = timeToMinutes(existingShiftInfo.startTime);
            let existingEnd = timeToMinutes(existingShiftInfo.endTime);
            if (existingEnd <= existingStart) existingEnd += 24 * 60;

            if (newStart < existingEnd && newEnd > existingStart) {
                setError(`Conflicto de horario: Este turno (${newShiftInfo.name}) se superpone con el turno existente (${existingShiftInfo.name}).`);
                return;
            }
        }
    }

    const success = onSave({ doctorId, date: shiftDate, time }, shift?.id);
    if (success) {
      onClose();
    }
  };

  const handleDelete = () => {
    if(shift?.id && window.confirm('¿Está seguro de que desea eliminar este turno?')) {
      onDelete(shift.id);
      onClose();
    }
  }

  const title = mode === 'edit' ? 'Editar Turno' : (date ? `Agregar Turno para ${date}` : 'Agregar Nuevo Turno');

  return (
    <Modal onClose={onClose} title={title}>
      <form onSubmit={handleSave}>
         {mode === 'new' && !date && (
            <div className="form-group">
                <label htmlFor="shift-date-picker">Fecha del Turno</label>
                <input
                    id="shift-date-picker"
                    type="date"
                    value={manualDate}
                    onChange={e => setManualDate(e.target.value)}
                    required
                />
            </div>
        )}
        <div className="form-group">
          <label htmlFor="doctor-select">Médico</label>
          <select id="doctor-select" value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setError(''); }}>
            {doctorsWithSpecialty.map(doc => (
              <option key={doc.id} value={doc.id}>{doc.name} ({doc.specialty})</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="shift-time">Horario del Turno</label>
          <select id="shift-time" value={time} onChange={(e) => setTime(e.target.value as ShiftTime)}>
            <optgroup label="Horarios Estándar">
              {Object.entries(defaultShifts).map(([key, value]) => (
                <option key={key} value={key}>{value.translation}</option>
              ))}
            </optgroup>
            {availableCustomShifts.length > 0 && (
              <optgroup label="Horarios Personalizados">
                {availableCustomShifts.map(cs => (
                  <option key={cs.id} value={cs.id}>{cs.name} ({cs.startTime}-{cs.endTime})</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        {error && <p className="error-message">{error}</p>}
        <div className="form-actions">
           {mode === 'edit' && <button type="button" className="button-danger" onClick={handleDelete}>Eliminar</button>}
          <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button-primary">Guardar</button>
        </div>
      </form>
    </Modal>
  );
};

const AutoScheduleModal: React.FC<{
  onClose: () => void;
  onGenerate: (specialty: string, clearShifts: boolean) => void;
  specialties: Specialty[];
  isGenerating: boolean;
  error: string;
  onClearError: () => void;
}> = ({ onClose, onGenerate, specialties, isGenerating, error, onClearError }) => {
  const [selectedSpecialty, setSelectedSpecialty] = useState(specialties[0]?.name || '');
  const [clearShifts, setClearShifts] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSpecialty) {
      setLocalError('Por favor, seleccione una especialidad.');
      return;
    }
    setLocalError('');
    onGenerate(selectedSpecialty, clearShifts);
  };

  return (
    <Modal onClose={onClose} title="Generar Horario Automático con IA">
      <form onSubmit={handleSubmit}>
        {isGenerating ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Contactando al asistente de IA y generando el horario... Esto puede tardar un momento.</p>
          </div>
        ) : (
          <>
            <p style={{textAlign: 'center', marginTop: 0}}>Seleccione una especialidad para generar automáticamente sus guardias (diurnas y nocturnas) para el mes actual.</p>
            <div className="form-group">
              <label htmlFor="auto-specialty-select">Especialidad</label>
              <select 
                id="auto-specialty-select" 
                value={selectedSpecialty} 
                onChange={(e) => { setSelectedSpecialty(e.target.value); onClearError(); setLocalError(''); }} 
                disabled={specialties.length === 0}
              >
                {specialties.length > 0 ? specialties.map(s => <option key={s.name} value={s.name}>{s.name}</option>) : <option>No hay especialidades</option>}
              </select>
            </div>
            <div className="form-group-checkbox">
              <input type="checkbox" id="clear-shifts-checkbox" checked={clearShifts} onChange={(e) => setClearShifts(e.target.checked)} />
              <label htmlFor="clear-shifts-checkbox">Limpiar los turnos existentes de esta especialidad para este mes antes de generar.</label>
            </div>
            {(localError || error) && <p className="error-message">{localError || error}</p>}
            <div className="form-actions">
              <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
              <button type="submit" className="button-primary" disabled={!selectedSpecialty || isGenerating}>
                {isGenerating ? 'Generando...' : 'Generar Horario'}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
};


const ManagementModal: React.FC<{
  onClose: () => void;
  doctors: Doctor[];
  specialties: Specialty[];
  users: User[];
  customShifts: CustomShift[];
  currentUser: User;
  onAddDoctor: (doctor: Omit<Doctor, 'id'>) => void;
  onEditDoctor: (doctor: Doctor) => void;
  onAddSpecialty: (specialtyName: string) => boolean;
  onAddUser: (user: Omit<User, 'id'>) => boolean;
  onAddCustomShift: (shift: Omit<CustomShift, 'id'>) => boolean;
  onDeleteDoctor: (doctorId: string) => string;
  onDeleteSpecialty: (specialtyName: string) => string;
  onDeleteUser: (userId: string) => string;
  onDeleteCustomShift: (shiftId: string) => string;
}> = ({ onClose, doctors, specialties, users, customShifts, currentUser, onAddDoctor, onEditDoctor, onAddSpecialty, onAddUser, onAddCustomShift, onDeleteDoctor, onDeleteSpecialty, onDeleteUser, onDeleteCustomShift }) => {
    const [activeTab, setActiveTab] = useState<'doctors' | 'specialties' | 'users' | 'shifts'>('doctors');
    
    const doctorsForRole = useMemo(() => {
        if (currentUser.role === 'user') {
            return doctors.filter(doc => doc.specialty === currentUser.specialty);
        }
        return doctors;
    }, [doctors, currentUser]);

    // Doctor state
    const [editingDoctor, setEditingDoctor] = useState<Doctor | null>(null);
    const [doctorName, setDoctorName] = useState('');
    const [doctorDni, setDoctorDni] = useState('');
    const [doctorCargo, setDoctorCargo] = useState('');
    const [doctorCondicion, setDoctorCondicion] = useState('');
    const [doctorSpecialty, setDoctorSpecialty] = useState<string>(
        currentUser.role === 'user' && currentUser.specialty ? currentUser.specialty : (specialties[0]?.name || '')
    );
    const [doctorError, setDoctorError] = useState('');
    const [doctorToDelete, setDoctorToDelete] = useState('');

    // Specialty state
    const [newSpecialtyName, setNewSpecialtyName] = useState('');
    const [specialtyError, setSpecialtyError] = useState('');

    // User state
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<UserRole>('user');
    const [userSpecialty, setUserSpecialty] = useState<string>(specialties[0]?.name || '');
    const [userError, setUserError] = useState('');
    const [userToDelete, setUserToDelete] = useState('');

    // Custom Shift state
    const [csName, setCsName] = useState('');
    const [csAbbr, setCsAbbr] = useState('');
    const [csStart, setCsStart] = useState('08:00');
    const [csEnd, setCsEnd] = useState('12:00');
    const [csColor, setCsColor] = useState('#34d399');
    const [csSpecialty, setCsSpecialty] = useState(specialties[0]?.name || '');
    const [csError, setCsError] = useState('');
    
    const [deletionError, setDeletionError] = useState('');
    
    useEffect(() => {
        if (activeTab === 'doctors') {
            if (doctorsForRole.length > 0 && !doctorsForRole.some(d => d.id === doctorToDelete)) {
                setDoctorToDelete(doctorsForRole[0].id);
            } else if (doctorsForRole.length === 0) {
                setDoctorToDelete('');
            }
        } else if (activeTab === 'users') {
            const deletableUsers = users.filter(u => u.id !== currentUser.id);
            if (deletableUsers.length > 0) {
                if (!deletableUsers.some(u => u.id === userToDelete)) {
                    setUserToDelete(deletableUsers[0].id);
                }
            } else {
                setUserToDelete('');
            }
        }
    }, [doctorsForRole, users, currentUser, activeTab, doctorToDelete, userToDelete]);

    const handleTabClick = (tab: 'doctors' | 'specialties' | 'users' | 'shifts') => {
        setActiveTab(tab);
        setDeletionError('');
        setDoctorError('');
        setSpecialtyError('');
        setUserError('');
        setCsError('');
    }

    const handleSaveDoctor = (e: React.FormEvent) => {
        e.preventDefault();
        setDeletionError('');
        if (!doctorName.trim() || !doctorSpecialty || !doctorDni.trim() || !doctorCargo.trim() || !doctorCondicion.trim()) {
            setDoctorError('Todos los campos son obligatorios.');
            return;
        }
        
        const newDoctorData = {
            name: doctorName,
            specialty: doctorSpecialty,
            dni: doctorDni,
            cargo: doctorCargo,
            condicionLaboral: doctorCondicion,
        };

        if (editingDoctor) {
            onEditDoctor({ ...editingDoctor, ...newDoctorData });
        } else {
            onAddDoctor(newDoctorData);
        }
        handleCancelEdit();
    };

    const handleEditClick = (doctor: Doctor) => {
        setEditingDoctor(doctor);
        setDoctorName(doctor.name);
        setDoctorSpecialty(doctor.specialty);
        setDoctorDni(doctor.dni);
        setDoctorCargo(doctor.cargo);
        setDoctorCondicion(doctor.condicionLaboral);
        setDoctorError('');
        setDeletionError('');
    };
    
    const handleCancelEdit = () => {
        setEditingDoctor(null);
        setDoctorName('');
        setDoctorDni('');
        setDoctorCargo('');
        setDoctorCondicion('');
        setDoctorSpecialty(currentUser.role === 'user' && currentUser.specialty ? currentUser.specialty : (specialties[0]?.name || ''));
        setDoctorError('');
    };
    
    const handleDeleteDoctorClick = () => {
        if (doctorToDelete) {
            const error = onDeleteDoctor(doctorToDelete);
            setDeletionError(error);
        }
    };

    const handleAddSpecialty = (e: React.FormEvent) => {
        e.preventDefault();
        setDeletionError('');
        if (!newSpecialtyName.trim()) {
            setSpecialtyError('El nombre de la especialidad es obligatorio.');
            return;
        }
        if (!onAddSpecialty(newSpecialtyName)) {
            setSpecialtyError('Esta especialidad ya existe.');
        } else {
            setNewSpecialtyName('');
            setSpecialtyError('');
        }
    };

    const handleAddUser = (e: React.FormEvent) => {
        e.preventDefault();
        setDeletionError('');
        if (!username.trim() || !password.trim()) {
            setUserError('Usuario y contraseña son obligatorios.');
            return;
        }
        if (role === 'user' && !userSpecialty) {
            setUserError('Un usuario con rol "Usuario" debe tener una especialidad asignada.');
            return;
        }
        
        const userData: Omit<User, 'id'> = {
            username,
            password,
            role,
            ...(role === 'user' && { specialty: userSpecialty })
        };
        
        if (!onAddUser(userData)) {
            setUserError('El nombre de usuario ya existe.');
        } else {
            setUsername('');
            setPassword('');
            setUserError('');
        }
    };

    const handleAddCustomShift = (e: React.FormEvent) => {
        e.preventDefault();
        setDeletionError('');
        if (!csName.trim() || !csAbbr.trim() || !csStart || !csEnd) {
            setCsError('Todos los campos son obligatorios.');
            return;
        }
        if (!csSpecialty && specialties.length > 0) {
            setCsError('Por favor, seleccione un servicio/especialidad.');
            return;
        }
        const start = new Date(`1970-01-01T${csStart}`);
        const end = new Date(`1970-01-01T${csEnd}`);
        if (start >= end) {
            setCsError('La hora de inicio debe ser anterior a la hora de fin.');
            return;
        }
        const duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

        const success = onAddCustomShift({ name: csName, abbreviation: csAbbr, startTime: csStart, endTime: csEnd, color: csColor, duration, specialtyName: csSpecialty });
        if(success) {
            setCsName('');
            setCsAbbr('');
            setCsError('');
        } else {
            setCsError('Ya existe un horario con este nombre o abreviatura.');
        }
    };
    
    const handleDeleteUserClick = () => {
        if (userToDelete) {
            const error = onDeleteUser(userToDelete);
            setDeletionError(error);
        }
    };

    return (
        <Modal onClose={onClose} title="Gestionar">
            <div className="management-content">
                <div className="modal-tabs">
                    <button className={`modal-tab ${activeTab === 'doctors' ? 'active' : ''}`} onClick={() => handleTabClick('doctors')}>Médicos</button>
                    {currentUser.role === 'admin' && (
                        <>
                            <button className={`modal-tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => handleTabClick('users')}>Usuarios</button>
                            <button className={`modal-tab ${activeTab === 'specialties' ? 'active' : ''}`} onClick={() => handleTabClick('specialties')}>Especialidades</button>
                            <button className={`modal-tab ${activeTab === 'shifts' ? 'active' : ''}`} onClick={() => handleTabClick('shifts')}>Horarios</button>
                        </>
                    )}
                </div>
                <div className="modal-tab-content">
                    {activeTab === 'doctors' && (
                        <div>
                             <h3>{editingDoctor ? 'Editar Médico' : 'Agregar Nuevo Médico'}</h3>
                            <form onSubmit={handleSaveDoctor}>
                                <div className="form-group"><label htmlFor="doc-name">Apellidos y Nombres</label><input id="doc-name" type="text" value={doctorName} onChange={e => { setDoctorName(e.target.value); setDoctorError(''); }} /></div>
                                <div className="form-group-inline" style={{gridTemplateColumns: '1fr 1fr', marginBottom: '1rem'}}>
                                    <div className="form-group"><label htmlFor="doc-dni">DNI</label><input id="doc-dni" type="text" value={doctorDni} onChange={e => { setDoctorDni(e.target.value); setDoctorError(''); }} /></div>
                                    <div className="form-group"><label htmlFor="doc-cargo">Cargo</label><input id="doc-cargo" type="text" value={doctorCargo} onChange={e => { setDoctorCargo(e.target.value); setDoctorError(''); }} /></div>
                                </div>
                                <div className="form-group-inline" style={{gridTemplateColumns: '1fr 1fr'}}>
                                     <div className="form-group"><label htmlFor="doc-condicion">Condición Laboral</label><input id="doc-condicion" type="text" value={doctorCondicion} onChange={e => { setDoctorCondicion(e.target.value); setDoctorError(''); }} /></div>
                                    <div className="form-group"><label htmlFor="doc-specialty">Servicio / Especialidad</label>
                                    <select id="doc-specialty" value={doctorSpecialty} onChange={e => setDoctorSpecialty(e.target.value)} disabled={currentUser.role === 'user'}>
                                        {currentUser.role === 'admin' 
                                            ? specialties.map(s => <option key={s.name} value={s.name}>{s.name}</option>)
                                            : (currentUser.specialty && <option key={currentUser.specialty} value={currentUser.specialty}>{currentUser.specialty}</option>)
                                        }
                                    </select>
                                    </div>
                                </div>
                                {doctorError && <p className="error-message">{doctorError}</p>}
                                <div className="form-actions">
                                    {editingDoctor && <button type="button" className="button-secondary" onClick={handleCancelEdit}>Cancelar</button>}
                                    <button type="submit" className="button-primary">{editingDoctor ? 'Guardar Cambios' : 'Agregar Médico'}</button>
                                </div>
                            </form>
                            <hr />
                            <h3>Gestionar Médicos Existentes</h3>
                            {deletionError && <p className="error-message">{deletionError}</p>}
                            <div className="form-group">
                                <div className="item-list-control">
                                    <select aria-label="Médico a eliminar" value={doctorToDelete} onChange={e => setDoctorToDelete(e.target.value)} disabled={doctorsForRole.length === 0}>
                                        {doctorsForRole.length > 0 ? doctorsForRole.map(doc => (
                                            <option key={doc.id} value={doc.id}>{doc.name} ({doc.specialty})</option>
                                        )) : <option>No hay médicos para eliminar</option>}
                                    </select>
                                    <button type="button" className="button-danger" onClick={handleDeleteDoctorClick} disabled={!doctorToDelete}>
                                        Eliminar
                                    </button>
                                </div>
                            </div>
                            {doctorsForRole.length > 0 ? (
                                <ul className="item-list">
                                {doctorsForRole.map(doc => (
                                    <li key={doc.id} className="item-list-doctor">
                                        <div className="item-info">
                                            <strong>{doc.name}</strong>
                                            <span>{doc.cargo} &bull; {doc.specialty}</span>
                                        </div>
                                        <button onClick={() => handleEditClick(doc)} className="button-secondary" style={{padding: '0.25rem 0.5rem', fontSize: '0.8rem'}}>Editar</button>
                                    </li>
                                ))}
                                </ul>
                            ) : (
                                <p className="empty-list-message" style={{textAlign: 'center', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '4px'}}>No hay médicos registrados.</p>
                            )}
                        </div>
                    )}
                     {currentUser.role === 'admin' && activeTab === 'users' && (
                        <div>
                            <h3>Agregar Nuevo Usuario</h3>
                            <form onSubmit={handleAddUser}>
                                <div className="form-group"><label htmlFor="username">Nombre de Usuario</label><input id="username" type="text" value={username} onChange={e => { setUsername(e.target.value); setUserError(''); }} /></div>
                                <div className="form-group"><label htmlFor="password">Contraseña</label><input id="password" type="password" value={password} onChange={e => { setPassword(e.target.value); setUserError(''); }} /></div>
                                <div className="form-group">
                                    <label htmlFor="role">Rol</label>
                                    <select id="role" value={role} onChange={e => setRole(e.target.value as UserRole)}>
                                        <option value="user">Usuario</option>
                                        <option value="admin">Administrador</option>
                                    </select>
                                </div>
                                {role === 'user' && (
                                    <div className="form-group">
                                        <label htmlFor="user-specialty">Especialidad</label>
                                        <select id="user-specialty" value={userSpecialty} onChange={e => setUserSpecialty(e.target.value)}>{specialties.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                                        </select>
                                    </div>
                                )}
                                {userError && <p className="error-message">{userError}</p>}
                                <div className="form-actions"><button type="submit" className="button-primary">Agregar Usuario</button></div>
                            </form>
                            <hr />
                            <h3>Gestionar Usuarios Existentes</h3>
                            {deletionError && <p className="error-message">{deletionError}</p>}
                            <div className="form-group">
                                <div className="item-list-control">
                                    <select aria-label="Usuario a eliminar" value={userToDelete} onChange={e => setUserToDelete(e.target.value)} disabled={users.filter(u => u.id !== currentUser.id).length === 0}>
                                        {users.filter(u => u.id !== currentUser.id).length > 0 ? (
                                            users.filter(u => u.id !== currentUser.id).map(u => (
                                                <option key={u.id} value={u.id}>{u.username} ({u.role === 'admin' ? 'Admin' : u.specialty})</option>
                                            ))
                                        ) : (
                                            <option>No hay otros usuarios para eliminar</option>
                                        )}
                                    </select>
                                    <button type="button" className="button-danger" onClick={handleDeleteUserClick} disabled={!userToDelete}>
                                        Eliminar
                                    </button>
                                </div>
                            </div>
                            {users.length > 0 ? (
                                <ul className="item-list">
                                    {users.map(u => (
                                        <li key={u.id}>
                                            <div className="item-info"><strong>{u.username}</strong><span className="user-role">{u.role === 'admin' ? 'Administrador' : `Usuario - ${u.specialty}`}</span></div>
                                             {u.id === currentUser.id && <span style={{fontSize: '0.8rem', color: 'var(--secondary-color)', marginLeft: 'auto', paddingLeft: '1rem'}}>(Sesión actual)</span>}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="empty-list-message" style={{textAlign: 'center', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '4px'}}>No hay usuarios registrados.</p>
                            )}
                        </div>
                    )}
                    {currentUser.role === 'admin' && activeTab === 'specialties' && (
                        <div>
                            <h3>Especialidades Actuales</h3>
                            {deletionError && <p className="error-message">{deletionError}</p>}
                            <ul className="item-list">
                                {specialties.map(s => (
                                    <li key={s.name}>
                                        <span><span className="color-dot" style={{ backgroundColor: s.color }}></span> {s.name}</span>
                                        <button onClick={() => setDeletionError(onDeleteSpecialty(s.name))} className="delete-item-button" title="Eliminar especialidad">&times;</button>
                                    </li>
                                ))}
                            </ul><hr />
                            <h3>Agregar Nueva Especialidad</h3>
                            <form onSubmit={handleAddSpecialty}>
                                <div className="form-group"><label htmlFor="specialty-name">Nombre</label><input id="specialty-name" type="text" value={newSpecialtyName} onChange={e => { setNewSpecialtyName(e.target.value); setSpecialtyError(''); }} /></div>
                                {specialtyError && <p className="error-message">{specialtyError}</p>}
                                <div className="form-actions"><button type="submit" className="button-primary">Agregar Especialidad</button></div>
                            </form>
                        </div>
                    )}
                    {currentUser.role === 'admin' && activeTab === 'shifts' && (
                        <div>
                            <h3>Agregar Horario Personalizado</h3>
                             <form onSubmit={handleAddCustomShift}>
                                <div className="form-group"><label htmlFor="cs-name">Nombre del Turno</label><input id="cs-name" type="text" value={csName} onChange={e => { setCsName(e.target.value); setCsError(''); }} placeholder="e.g., Consulta Externa" /></div>
                                <div className="form-group">
                                    <label htmlFor="cs-specialty">Servicio / Especialidad</label>
                                    <select id="cs-specialty" value={csSpecialty} onChange={e => setCsSpecialty(e.target.value)} disabled={specialties.length === 0}>
                                        {specialties.length > 0 ? specialties.map(s => <option key={s.name} value={s.name}>{s.name}</option>) : <option>No hay especialidades creadas</option>}
                                    </select>
                                </div>
                                <div className="form-group-inline">
                                    <div className="form-group"><label htmlFor="cs-abbr">Abreviatura</label><input id="cs-abbr" type="text" value={csAbbr} onChange={e => setCsAbbr(e.target.value.toUpperCase())} maxLength={4} placeholder="e.g., CE" /></div>
                                    <div className="form-group"><label htmlFor="cs-start">Hora Inicio</label><input id="cs-start" type="time" value={csStart} onChange={e => { setCsStart(e.target.value); setCsError(''); }} /></div>
                                    <div className="form-group"><label htmlFor="cs-end">Hora Fin</label><input id="cs-end" type="time" value={csEnd} onChange={e => { setCsEnd(e.target.value); setCsError(''); }} /></div>
                                    <div className="form-group"><label htmlFor="cs-color">Color</label><input id="cs-color" type="color" value={csColor} onChange={e => setCsColor(e.target.value)} className="color-input" /></div>
                                </div>
                                {csError && <p className="error-message">{csError}</p>}
                                <div className="form-actions"><button type="submit" className="button-primary">Agregar Horario</button></div>
                            </form>
                            <hr />
                            <h3>Horarios Personalizados Existentes</h3>
                            {deletionError && <p className="error-message">{deletionError}</p>}
                             {customShifts.length > 0 ? (
                                <ul className="item-list">
                                {customShifts.map(cs => (
                                    <li key={cs.id}>
                                        <span><span className="color-dot" style={{ backgroundColor: cs.color }}></span></span>
                                        <div className="item-info">
                                            <strong>{cs.name} ({cs.abbreviation})</strong>
                                            <span>{cs.specialtyName} &bull; {cs.startTime} - {cs.endTime} ({cs.duration.toFixed(2)} hs)</span>
                                        </div>
                                        <button onClick={() => setDeletionError(onDeleteCustomShift(cs.id))} className="delete-item-button" title="Eliminar horario">&times;</button>
                                    </li>
                                ))}
                                </ul>
                            ) : (
                                <p className="empty-list-message" style={{textAlign: 'center', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '4px'}}>No hay horarios personalizados.</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};


interface DoctorSidebarProps {
  doctors: Doctor[];
  specialtiesMap: Map<string, Specialty>;
  onDragStart: (e: React.DragEvent, doctorId: string) => void;
  onDragEnd: () => void;
  isOpen: boolean;
  doctorMonthlyHours: Map<string, number>;
  doctorWeeklyHours: Map<string, number>;
  doctorFilter: string;
  onDoctorFilterChange: (filterValue: string) => void;
  specialties: Specialty[];
  showFilter: boolean;
}

const DoctorSidebar: React.FC<DoctorSidebarProps> = ({
  doctors,
  specialtiesMap,
  onDragStart,
  onDragEnd,
  isOpen,
  doctorMonthlyHours,
  doctorWeeklyHours,
  doctorFilter,
  onDoctorFilterChange,
  specialties,
  showFilter,
}) => (
    <aside className={`doctor-sidebar ${isOpen ? 'open' : ''}`}>
        <h3>Médicos</h3>
        {showFilter && (
            <div className="sidebar-filter-container">
                <label htmlFor="doctor-filter-select">Filtrar por Especialidad</label>
                <select id="doctor-filter-select" value={doctorFilter} onChange={(e) => onDoctorFilterChange(e.target.value)}>
                    <option value="all">Todas las especialidades</option>
                    {specialties.map(s => (<option key={s.name} value={s.name}>{s.name}</option>))}
                </select>
            </div>
        )}
        <div className="doctor-items">
            {doctors.length > 0 ? doctors.map(doc => {
                const specialty = specialtiesMap.get(doc.specialty);
                const monthlyHours = doctorMonthlyHours.get(doc.id) || 0;
                const weeklyHours = doctorWeeklyHours.get(doc.id) || 0;
                let hourStatusClass = 'status-ok';

                if (monthlyHours >= MAX_HOURS_CRITICAL || weeklyHours > MAX_WEEKLY_HOURS) {
                    hourStatusClass = 'status-critical';
                } else if (monthlyHours > MAX_HOURS_WARNING) {
                    hourStatusClass = 'status-warning';
                } else if (monthlyHours < MIN_HOURS) {
                    hourStatusClass = 'status-low';
                }

                return (
                    <div key={doc.id} className="doctor-item" draggable onDragStart={(e) => onDragStart(e, doc.id)} onDragEnd={onDragEnd}>
                        <span className="doctor-item-color" style={{ backgroundColor: specialty?.color || '#ccc' }}></span>
                        <div className="doctor-item-info">
                            <strong>{doc.name}</strong>
                             <div className="doctor-sub-info">
                                <span>{doc.specialty}</span>
                                <span 
                                  className={`hours-indicator ${hourStatusClass}`}
                                  title={`Horas este mes: ${monthlyHours}\nHoras esta semana: ${weeklyHours}`}
                                >
                                    {monthlyHours} hrs
                                </span>
                            </div>
                        </div>
                    </div>
                )
            }) : ( <p className="empty-list-message">No hay médicos para mostrar.</p> )}
        </div>
    </aside>
);

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [doctors, setDoctors] = useState<Doctor[]>(initialDoctors);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [shifts, setShifts] = useState<Shift[]>(initialShifts);
  const [specialties, setSpecialties] = useState<Specialty[]>(initialSpecialties);
  const [customShifts, setCustomShifts] = useState<CustomShift[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('month');

  const [shiftModalState, setShiftModalState] = useState<ModalState>({ isOpen: false, mode: 'new' });
  const [isManagementModalOpen, setManagementModalOpen] = useState(false);
  const [isAutoScheduleModalOpen, setAutoScheduleModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [autoScheduleError, setAutoScheduleError] = useState('');
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  
  const [draggedDoctorId, setDraggedDoctorId] = useState<string | null>(null);

  const [specialtyFilter, setSpecialtyFilter] = useState<string>('all');
  const [doctorFilter, setDoctorFilter] = useState<string>('all');
  
  const calendarViewRef = useRef<HTMLElement>(null);
  
  const doctorsMap = useMemo(() => new Map(doctors.map(d => [d.id, d])), [doctors]);
  const specialtiesMap = useMemo(() => new Map(specialties.map(s => [s.name, s])), [specialties]);
  
  const allShiftsMap = useMemo(() => {
    const map = new Map<string, ShiftInfo>();
    for (const key in defaultShifts) {
        map.set(key, {
            name: defaultShifts[key].translation,
            abbreviation: defaultShifts[key].abbreviation,
            duration: defaultShifts[key].duration,
            startTime: defaultShifts[key].startTime,
            endTime: defaultShifts[key].endTime,
        });
    }
    customShifts.forEach(cs => {
        map.set(cs.id, {
            name: cs.name,
            abbreviation: cs.abbreviation,
            duration: cs.duration,
            startTime: cs.startTime,
            endTime: cs.endTime,
        });
    });
    return map;
  }, [customShifts]);

  const doctorMonthlyHours = useMemo(() => {
    const month = currentDate.getMonth();
    const year = currentDate.getFullYear();
    const hoursMap = new Map<string, number>();
    doctors.forEach(doctor => {
        const doctorShifts = shifts.filter(s => s.doctorId === doctor.id && new Date(s.date).getMonth() === month && new Date(s.date).getFullYear() === year);
        const totalHours = doctorShifts.reduce((acc, shift) => acc + (allShiftsMap.get(shift.time)?.duration || 0), 0);
        hoursMap.set(doctor.id, totalHours);
    });
    return hoursMap;
  }, [shifts, doctors, currentDate, allShiftsMap]);
  
  const doctorWeeklyHours = useMemo(() => {
    const weekDays = getWeekDays(currentDate);
    const startOfWeek = weekDays[0];
    const endOfWeek = weekDays[6];
    startOfWeek.setHours(0,0,0,0);
    endOfWeek.setHours(23,59,59,999);
    
    const hoursMap = new Map<string, number>();
    doctors.forEach(doctor => {
        const weeklyShifts = shifts.filter(s => {
            const shiftDate = new Date(s.date);
            return s.doctorId === doctor.id && shiftDate >= startOfWeek && shiftDate <= endOfWeek;
        });
        const totalHours = weeklyShifts.reduce((acc, shift) => acc + (allShiftsMap.get(shift.time)?.duration || 0), 0);
        hoursMap.set(doctor.id, totalHours);
    });
    return hoursMap;
  }, [shifts, doctors, currentDate, allShiftsMap]);

  const filteredShifts = useMemo(() => {
    return shifts.filter(shift => {
      if (specialtyFilter === 'all') return true;
      const doctor = doctorsMap.get(shift.doctorId);
      return doctor?.specialty === specialtyFilter;
    });
  }, [shifts, specialtyFilter, doctorsMap]);
  
  const filteredDoctors = useMemo(() => {
    let doctorsToFilter = doctors;
    if (currentUser?.role === 'user') {
      doctorsToFilter = doctors.filter(doc => doc.specialty === currentUser.specialty);
    } else if (doctorFilter !== 'all') {
      doctorsToFilter = doctors.filter(doc => doc.specialty === doctorFilter);
    }
    return doctorsToFilter;
  }, [doctors, doctorFilter, currentUser]);

  const handleLogin = (username: string, password: string): boolean => {
      const user = users.find(u => u.username === username && u.password === password);
      if (user) {
          setCurrentUser(user);
          if (user.role === 'user') {
              setSpecialtyFilter(user.specialty || 'all');
              setDoctorFilter(user.specialty || 'all');
          }
          return true;
      }
      return false;
  };

  const handleLogout = () => {
      setCurrentUser(null);
      setSpecialtyFilter('all');
      setDoctorFilter('all');
  };

  const handleDragStart = (e: React.DragEvent, doctorId: string) => {
      setDraggedDoctorId(doctorId);
      e.dataTransfer.effectAllowed = 'move';
      (e.currentTarget as HTMLElement).classList.add('is-dragging');
  };
  
  const handleDragEnd = () => {
    document.querySelector('.is-dragging')?.classList.remove('is-dragging');
    setDraggedDoctorId(null);
  };

  const handleDrop = (e: React.DragEvent, date: string, time?: ShiftTime) => {
      e.preventDefault();
      if (draggedDoctorId) {
          setShiftModalState({ isOpen: true, mode: 'new', date, prefilledDoctorId: draggedDoctorId, prefilledTime: time });
      }
      (e.currentTarget as HTMLElement).classList.remove('drag-over');
  };
  
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('drag-over'); };
  const handleDragLeave = (e: React.DragEvent) => { (e.currentTarget as HTMLElement).classList.remove('drag-over'); };
  
  const openShiftModal = (mode: 'new' | 'edit', date?: string, shift?: Shift, time?: ShiftTime) => setShiftModalState({ isOpen: true, mode, date, shift, prefilledTime: time });
  
  const handleSaveShift = useCallback((newShiftData: Omit<Shift, 'id'>, id?: string) => {
    if (id) setShifts(prev => prev.map(s => s.id === id ? { ...s, ...newShiftData } : s));
    else setShifts(prev => [...prev, { ...newShiftData, id: `shift_${Date.now()}` }]);
    return true;
  }, []);
  
  const handleDeleteShift = useCallback((shiftId: string) => setShifts(prev => prev.filter(s => s.id !== shiftId)), []);
  
  const handleAddDoctor = useCallback((newDoctorData: Omit<Doctor, 'id'>) => setDoctors(prev => [...prev, {...newDoctorData, id: `doc_${Date.now()}`}]), []);
  
  const handleEditDoctor = useCallback((updatedDoctor: Doctor) => {
    setDoctors(prev => prev.map(d => d.id === updatedDoctor.id ? updatedDoctor : d));
  }, []);
  
  const handleDeleteDoctor = useCallback((doctorId: string): string => {
    const doctor = doctors.find(d => d.id === doctorId);
    if (!doctor) return "Médico no encontrado.";

    if (window.confirm(`¿Está seguro de que desea eliminar al médico "${doctor.name}"? Esta acción no se puede deshacer y se borrarán todos sus turnos.`)) {
        setDoctors(prev => prev.filter(d => d.id !== doctorId));
        setShifts(prev => prev.filter(s => s.doctorId !== doctorId));
        return '';
    }
    return '';
  }, [doctors]);

  const handleAddSpecialty = useCallback((specialtyName: string) => {
      if(specialties.some(s => s.name.toLowerCase() === specialtyName.toLowerCase())) return false;
      const usedColors = new Set(specialties.map(s => s.color));
      const newColor = newSpecialtyColorPalette.find(c => !usedColors.has(c)) || `#${Math.floor(Math.random()*16777215).toString(16)}`;
      setSpecialties(prev => [...prev, {name: specialtyName, color: newColor}]);
      return true;
  }, [specialties]);

  const handleDeleteSpecialty = useCallback((specialtyName: string): string => {
    if (doctors.some(d => d.specialty === specialtyName)) {
        return `No se puede eliminar "${specialtyName}" porque está asignada a uno o más médicos.`;
    }
    if (users.some(u => u.role === 'user' && u.specialty === specialtyName)) {
        return `No se puede eliminar "${specialtyName}" porque está asignada a uno o más usuarios.`;
    }
    if (window.confirm(`¿Está seguro de que desea eliminar la especialidad "${specialtyName}"?`)) {
        setSpecialties(prev => prev.filter(s => s.name !== specialtyName));
        return '';
    }
    return '';
  }, [doctors, users]);

  const handleAddUser = useCallback((newUserData: Omit<User, 'id'>) => {
      if(users.some(u => u.username.toLowerCase() === newUserData.username.toLowerCase())) return false;
      setUsers(prev => [...prev, {...newUserData, id: `user_${Date.now()}`}]);
      return true;
  }, [users]);

  const handleDeleteUser = useCallback((userId: string): string => {
      const user = users.find(u => u.id === userId);
      if (!user) return "Usuario no encontrado.";

      if (user.role === 'admin') {
          const adminCount = users.filter(u => u.role === 'admin').length;
          if (adminCount <= 1) {
              return "No se puede eliminar la única cuenta de administrador.";
          }
      }

      if (window.confirm(`¿Está seguro de que desea eliminar al usuario "${user.username}"?`)) {
          setUsers(prev => prev.filter(u => u.id !== userId));
          return '';
      }
      return '';
  }, [users]);

  const handleAddCustomShift = useCallback((newShiftData: Omit<CustomShift, 'id'>) => {
      if(customShifts.some(cs => cs.name.toLowerCase() === newShiftData.name.toLowerCase() || cs.abbreviation.toLowerCase() === newShiftData.abbreviation.toLowerCase())) return false;
      setCustomShifts(prev => [...prev, {...newShiftData, id: `custom_${Date.now()}`}]);
      return true;
  }, [customShifts]);

  const handleDeleteCustomShift = useCallback((shiftId: string): string => {
      if (shifts.some(s => s.time === shiftId)) {
          return "No se puede eliminar un tipo de horario que está actualmente en uso en el calendario.";
      }
      if (window.confirm(`¿Está seguro de que desea eliminar este tipo de horario?`)) {
          setCustomShifts(prev => prev.filter(cs => cs.id !== shiftId));
          return '';
      }
      return '';
  }, [shifts]);
  
    const handleGenerateSchedule = useCallback(async (specialtyName: string, clearExisting: boolean) => {
        setIsGenerating(true);
        setAutoScheduleError('');
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const monthName = capitalize(currentDate.toLocaleString('es-ES', { month: 'long' }));
            const daysInMonth = getDaysInMonth(year, month);

            const doctorsForSpecialty = doctors.filter(d => d.specialty === specialtyName);
            if (doctorsForSpecialty.length === 0) {
                throw new Error(`No hay médicos para la especialidad "${specialtyName}".`);
            }

            const existingShiftsForSpecialty = shifts.filter(s => {
                const doc = doctorsMap.get(s.doctorId);
                const shiftDate = new Date(s.date);
                return doc?.specialty === specialtyName && shiftDate.getFullYear() === year && shiftDate.getMonth() === month;
            });
            
            const prompt = `System Instruction: You are an expert hospital shift scheduler. Your task is to create an optimal monthly schedule. You must return the schedule as a valid JSON array of shift objects, adhering strictly to the provided JSON schema. Do not include any explanations or markdown formatting in your response.

Task:
Generate a full month's schedule for the specialty '${specialtyName}' for ${monthName} ${year}.

Constraints and Rules:
1.  Required Shifts: Every single day of the month (from day 1 to ${daysInMonth}) MUST have exactly one 'DayGuard' shift and one 'NightGuard' shift covered.
2.  Available Doctors: You must only use the following doctors. Distribute the shifts as evenly as possible among them.
    - Doctors (JSON format): ${JSON.stringify(doctorsForSpecialty.map(({id, name}) => ({id, name})))}
3.  Existing Shifts: The following shifts are already assigned for this month and MUST NOT be changed or duplicated. Take them into account when calculating total hours and applying rules. If this list is empty, generate a full schedule from scratch.
    - Existing Shifts (JSON format): ${JSON.stringify(existingShiftsForSpecialty.map(({doctorId, date, time}) => ({doctorId, date, time})))}
4.  Hour Limits: The total monthly hours for any doctor should ideally be between ${MIN_HOURS} and ${MAX_HOURS_WARNING} hours. Do not exceed ${MAX_HOURS_CRITICAL} hours under any circumstances. Each 'DayGuard' and 'NightGuard' is 12 hours.
5.  Consecutive Shifts Rule: A doctor CANNOT work any shift on the day immediately following a 'NightGuard' shift.
6.  Daily Limit: A doctor cannot work more than one shift per day.

Output Format:
Provide a JSON array of NEW shift objects to be added to complete the schedule. Each object must have 'doctorId', 'date' (format YYYY-MM-DD), and 'time' ('DayGuard' or 'NightGuard'). Do not include existing shifts in the output.`;

            const responseSchema = {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        doctorId: { type: Type.STRING },
                        date: { type: Type.STRING },
                        time: { type: Type.STRING, enum: ['DayGuard', 'NightGuard'] },
                    },
                    required: ['doctorId', 'date', 'time']
                }
            };
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash', contents: prompt,
                config: { responseMimeType: 'application/json', responseSchema: responseSchema }
            });

            let newShifts: Omit<Shift, 'id'>[] = JSON.parse(response.text);

            setShifts(prevShifts => {
                let updatedShifts = prevShifts;
                if (clearExisting) {
                    const doctorIdsForSpecialty = new Set(doctorsForSpecialty.map(d => d.id));
                    updatedShifts = prevShifts.filter(s => {
                        const shiftDate = new Date(s.date);
                        const isInMonth = shiftDate.getFullYear() === year && shiftDate.getMonth() === month;
                        return !(isInMonth && doctorIdsForSpecialty.has(s.doctorId));
                    });
                }
                const shiftsToAdd = newShifts.map(s => ({...s, id: `shift_${Date.now()}_${Math.random()}`}));
                return [...updatedShifts, ...shiftsToAdd];
            });

            setAutoScheduleModalOpen(false);

        } catch (error) {
            console.error("Error generating schedule:", error);
            setAutoScheduleError(error.message || 'Ocurrió un error inesperado al contactar la IA.');
        } finally {
            setIsGenerating(false);
        }
    }, [currentDate, doctors, shifts, doctorsMap]);

  const handleClearSpecialtySchedule = useCallback(() => {
    if (!currentUser || currentUser.role !== 'user' || !currentUser.specialty) {
        return;
    }

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthName = capitalize(currentDate.toLocaleString('es-ES', { month: 'long' }));
    const specialtyName = currentUser.specialty;

    if (window.confirm(`¿Está seguro de que desea eliminar todos los turnos para la especialidad "${specialtyName}" de ${monthName} ${year}? Esta acción no se puede deshacer.`)) {
        setShifts(prevShifts => {
            return prevShifts.filter(shift => {
                const doctor = doctorsMap.get(shift.doctorId);
                if (doctor?.specialty !== specialtyName) {
                    return true; // Keep shifts from other specialties
                }
                const shiftDate = new Date(shift.date);
                const shiftYear = shiftDate.getFullYear();
                const shiftMonth = shiftDate.getMonth();

                // Keep the shift if it's NOT in the current month/year for the specialty
                return !(shiftYear === year && shiftMonth === month);
            });
        });
    }
  }, [currentUser, currentDate, doctorsMap, setShifts]);


  const handlePrint = async () => {
    const printableElement = calendarViewRef.current;
    if (!printableElement) return;
    printableElement.classList.add('is-printing');
    try {
        const canvas = await html2canvas(printableElement, { scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? 'l' : 'p', unit: 'px', format: [canvas.width, canvas.height] });
        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save(`horario-${viewMode}-${formatDate(currentDate)}.pdf`);
    } finally { printableElement.classList.remove('is-printing'); }
  };
  
  const handleExportToExcel = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthName = capitalize(currentDate.toLocaleString('es-ES', { month: 'long' }));
    const daysInMonth = getDaysInMonth(year, month);
    const doctorsToExport = filteredDoctors;

    // Create custom headers
    const specialtyName = (specialtyFilter === 'all' ? 'TODOS LOS SERVICIOS' : specialtyFilter).toUpperCase();
    const titleHeader = [`PROGRAMACION DE TURNOS DE TRABAJO DEL SERVICIO DE ${specialtyName}`];
    const monthHeader = [`MES: ${monthName.toUpperCase()}`];
    const yearHeader = [`AÑO: ${year}`];
    const emptyRow = [''];

    // Create main table header
    const tableHeader = [
        'DNI',
        'APELLIDOS Y NOMBRES',
        'CARGO',
        'CONDICION LABORAL',
        'SERVICIO',
        ...Array.from({ length: daysInMonth }, (_, i) => String(i + 1)),
        'Horas Totales'
    ];
    
    // Map doctor data to rows
    const data = doctorsToExport.map(doctor => {
        const row: (string | number)[] = [
            doctor.dni,
            doctor.name,
            doctor.cargo,
            doctor.condicionLaboral,
            doctor.specialty,
        ];
        const shiftsByDay = new Map(
            shifts
                .filter(s => s.doctorId === doctor.id && new Date(s.date).getMonth() === month && new Date(s.date).getFullYear() === year)
                .map(s => [new Date(s.date).getDate(), s.time])
        );
        for (let day = 1; day <= daysInMonth; day++) {
            const shiftTime = shiftsByDay.get(day);
            row.push(shiftTime ? (allShiftsMap.get(shiftTime)?.abbreviation || '') : '');
        }
        row.push(doctorMonthlyHours.get(doctor.id) || 0);
        return row;
    });

    // Create legend data
    const legendHeader = ['LEYENDA DE TURNOS'];
    const legendSubHeader = ['Abreviatura', 'Descripción', 'Horas'];
    const legendData = [];
    allShiftsMap.forEach((shiftInfo) => {
        legendData.push([
            shiftInfo.abbreviation,
            shiftInfo.name,
            `${shiftInfo.duration} hs`
        ]);
    });

    // Create signature block data
    const signatureRows = [
        [], [], [], [],
        [null, '_________________________', '_________________________', '_________________________'],
        [null, 'Director', 'Jefe de Personal', 'Jefe de Servicio']
    ];

    const sheetData = [
        titleHeader, monthHeader, yearHeader, emptyRow, tableHeader,
        ...data, emptyRow, emptyRow,
        legendHeader, legendSubHeader, ...legendData,
        ...signatureRows
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    
    // --- STYLING ---
    const headerStyle = { font: { sz: 14, bold: true } };
    const centeredHeaderStyle = { ...headerStyle, alignment: { horizontal: "center", vertical: "center" } };

    // Apply styles to headers
    if(worksheet['A1']) worksheet['A1'].s = centeredHeaderStyle;
    if(worksheet['A2']) worksheet['A2'].s = headerStyle;
    if(worksheet['A3']) worksheet['A3'].s = headerStyle;

    tableHeader.forEach((_, colIndex) => {
        const cellAddress = XLSX.utils.encode_cell({ r: 4, c: colIndex });
        if (worksheet[cellAddress]) worksheet[cellAddress].s = centeredHeaderStyle;
    });

    const legendHeaderRowIndex = 5 + data.length + 2;
    const legendSubHeaderRowIndex = legendHeaderRowIndex + 1;
    
    const legendHeaderCell = worksheet[XLSX.utils.encode_cell({ r: legendHeaderRowIndex, c: 0 })];
    if (legendHeaderCell) legendHeaderCell.s = headerStyle;

    legendSubHeader.forEach((_, colIndex) => {
        const cellAddress = XLSX.utils.encode_cell({ r: legendSubHeaderRowIndex, c: colIndex });
        if (worksheet[cellAddress]) worksheet[cellAddress].s = centeredHeaderStyle;
    });

    const signatureTitleRowIndex = legendSubHeaderRowIndex + legendData.length + 5;
    for (let c = 1; c <= 3; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r: signatureTitleRowIndex, c });
        if(worksheet[cellAddress]) worksheet[cellAddress].s = { alignment: { horizontal: 'center' } };
    }
    
    // Merge cells for titles
    worksheet['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: tableHeader.length - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
        { s: { r: legendHeaderRowIndex, c: 0 }, e: { r: legendHeaderRowIndex, c: 2 } }
    ];

    // Set column widths
    worksheet['!cols'] = [
        { wch: 12 }, { wch: 30 }, { wch: 20 }, { wch: 20 }, { wch: 20 },
        ...Array(daysInMonth).fill({ wch: 4 }),
        { wch: 15 }
    ];
    
    const borderStyle = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    for (let R = range.s.r; R <= range.e.r; ++R) {
        // Skip bordering the signature lines and titles for a cleaner look
        const isSignatureRow = R >= legendSubHeaderRowIndex + legendData.length + 4;
        if (isSignatureRow) continue;
        
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cell_address = XLSX.utils.encode_cell({ r: R, c: C });
            let cell = worksheet[cell_address];
            if (!cell) {
                // Create empty cell to apply border
                cell = {};
                worksheet[cell_address] = cell;
            }
            if (!cell.s) cell.s = {};
            cell.s.border = borderStyle;
        }
    }
    
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Horario');
    XLSX.writeFile(workbook, `horario_${year}_${String(month + 1).padStart(2, '0')}.xlsx`);
  };

  const changeDate = (offset: number) => {
      setCurrentDate(prev => {
          const newDate = new Date(prev);
          if (viewMode === 'month') newDate.setMonth(prev.getMonth() + offset);
          else if (viewMode === 'week') newDate.setDate(prev.getDate() + (offset * 7));
          else newDate.setDate(prev.getDate() + offset);
          return newDate;
      })
  }
  
  const renderCalendarView = () => {
    const props = { shifts: filteredShifts, doctorsMap, specialtiesMap, allShiftsMap, onShiftClick: (shift: Shift) => openShiftModal('edit', undefined, shift), onDayClick: openShiftModal, handleDrop, handleDragOver, handleDragLeave };
    if (viewMode === 'day') return <DayView date={formatDate(currentDate)} {...props} />;
    if (viewMode === 'week') return <WeekView weekDays={getWeekDays(currentDate)} {...props} />;
    const { year, month } = { year: currentDate.getFullYear(), month: currentDate.getMonth() };
    return <MonthView year={year} month={month} daysInMonth={getDaysInMonth(year, month)} firstDay={getFirstDayOfMonth(year, month)} {...props} />;
  }

  const getHeaderText = () => {
    if(viewMode === 'day') return capitalize(currentDate.toLocaleString('es-ES', { dateStyle: 'full' }));
    if(viewMode === 'week') {
        const [start, end] = [getWeekDays(currentDate)[0], getWeekDays(currentDate)[6]];
        return `${start.toLocaleDateString('es-ES', {day: 'numeric', month: 'long'})} - ${end.toLocaleDateString('es-ES', {day: 'numeric', month: 'long', year: 'numeric'})}`;
    }
    return capitalize(currentDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' }));
  }

  if (!currentUser) {
      return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className={`app-layout ${isSidebarOpen ? 'sidebar-is-open' : ''}`}>
        <DoctorSidebar 
          doctors={filteredDoctors}
          specialties={specialties}
          specialtiesMap={specialtiesMap} 
          onDragStart={handleDragStart} 
          onDragEnd={handleDragEnd}
          isOpen={isSidebarOpen} 
          doctorMonthlyHours={doctorMonthlyHours}
          doctorWeeklyHours={doctorWeeklyHours}
          doctorFilter={doctorFilter}
          onDoctorFilterChange={setDoctorFilter}
          showFilter={currentUser.role === 'admin'}
        />
        <div className="main-content">
            <header className="app-header">
                <button className="hamburger-menu" onClick={() => setSidebarOpen(!isSidebarOpen)} aria-label="Toggle Menu"><span></span><span></span><span></span></button>
                <h1>Gestión de Turnos</h1>
                <div className="header-actions">
                   <button className="button-secondary" onClick={handlePrint}>Exportar PDF</button>
                   {viewMode === 'month' && <button className="button-secondary" onClick={handleExportToExcel}>Exportar (Excel)</button>}
                   {currentUser.role === 'admin' && <button className="button-primary" style={{backgroundColor: '#6366f1', border: 'none'}} onClick={() => { setAutoScheduleError(''); setAutoScheduleModalOpen(true); }}>Generar Automático</button>}
                   {currentUser.role === 'user' && <button className="button-primary" onClick={() => setShiftModalState({ isOpen: true, mode: 'new' })}>Agregar Turno</button>}
                   {(currentUser.role === 'admin' || currentUser.role === 'user') && <button className="button-primary" onClick={() => setManagementModalOpen(true)}>Gestionar</button>}
                   {currentUser.role === 'user' && <button className="button-danger" onClick={handleClearSpecialtySchedule}>Limpiar Horarios del Mes</button>}
                   <button className="button-logout" onClick={handleLogout}>Cerrar Sesión</button>
                </div>
            </header>
            <main className="calendar-container" ref={calendarViewRef}>
                <div className="calendar-controls">
                      {currentUser.role === 'admin' && (
                        <div className="specialty-filters">
                            <button className={`filter-button ${specialtyFilter === 'all' ? 'active' : ''}`} onClick={() => setSpecialtyFilter('all')}>Todas</button>
                            {specialties.map(s => (<button key={s.name} className={`filter-button ${specialtyFilter === s.name ? 'active' : ''}`} onClick={() => setSpecialtyFilter(s.name)} style={{ '--specialty-color': s.color } as React.CSSProperties}>{s.name}</button>))}
                        </div>
                      )}
                     <div className="view-switcher">
                        <button className={viewMode === 'month' ? 'active' : ''} onClick={() => setViewMode('month')}>Mes</button>
                        <button className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>Semana</button>
                        <button className={viewMode === 'day' ? 'active' : ''} onClick={() => setViewMode('day')}>Día</button>
                    </div>
                </div>
                <div className="calendar-header"><button onClick={() => changeDate(-1)}>&lt; Ant</button><h2>{getHeaderText()}</h2><button onClick={() => changeDate(1)}>Sig &gt;</button></div>
                {renderCalendarView()}
            </main>
            {isSidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}></div>}
            {shiftModalState.isOpen && <ShiftModal modalState={shiftModalState} onClose={() => setShiftModalState({ isOpen: false, mode: 'new' })} onSave={handleSaveShift} onDelete={handleDeleteShift} doctors={filteredDoctors} shifts={shifts} specialties={specialties} doctorMonthlyHours={doctorMonthlyHours} allShiftsMap={allShiftsMap} customShifts={customShifts} />}
            {isManagementModalOpen && <ManagementModal onClose={() => setManagementModalOpen(false)} doctors={doctors} specialties={specialties} users={users} customShifts={customShifts} currentUser={currentUser} onAddDoctor={handleAddDoctor} onEditDoctor={handleEditDoctor} onAddSpecialty={handleAddSpecialty} onAddUser={handleAddUser} onAddCustomShift={handleAddCustomShift} onDeleteDoctor={handleDeleteDoctor} onDeleteSpecialty={handleDeleteSpecialty} onDeleteUser={handleDeleteUser} onDeleteCustomShift={handleDeleteCustomShift} />}
            {isAutoScheduleModalOpen && <AutoScheduleModal
              onClose={() => setAutoScheduleModalOpen(false)}
              onGenerate={handleGenerateSchedule}
              specialties={specialties}
              isGenerating={isGenerating}
              error={autoScheduleError}
              onClearError={() => setAutoScheduleError('')}
            />}
        </div>
    </div>
  );
};

const MonthView = ({ year, month, daysInMonth, firstDay, shifts, doctorsMap, specialtiesMap, allShiftsMap, onShiftClick, onDayClick, handleDrop, handleDragOver, handleDragLeave }) => {
    const calendarDays = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
    return (
        <div className="calendar-grid month-view">
            {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(day => <div key={day} className="day-name">{day}</div>)}
            {calendarDays.map((day, index) => {
                const dateStr = day ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
                return (
                    <div key={index} className={`day-cell ${!day ? 'empty' : ''}`} onClick={() => day && onDayClick('new', dateStr)} onDrop={(e) => day && handleDrop(e, dateStr)} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
                        {day && <span className="day-number">{day}</span>}
                        <div className="shifts-in-day">
                            {day && shifts.filter(shift => shift.date === dateStr).map(shift => {
                                const doctor = doctorsMap.get(shift.doctorId);
                                const specialty = doctor ? specialtiesMap.get(doctor.specialty) : null;
                                const shiftInfo = allShiftsMap.get(shift.time);
                                if (!shiftInfo) return null;
                                return (
                                    <div key={shift.id} className={`shift-item ${shift.time === 'Vacation' ? 'vacation-item' : ''}`} style={{ backgroundColor: specialty?.color || '#ccc' }} title={`${doctor?.name} (${doctor?.specialty}) - ${shiftInfo.name}`} onClick={(e) => { e.stopPropagation(); onShiftClick(shift); }}>
                                        <span className="shift-time-indicator">{shiftInfo.abbreviation}</span>
                                        <div className="shift-details"><div className="shift-doctor-name">{doctor?.name}</div><div className="shift-doctor-specialty">{doctor?.specialty}</div></div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

const WeekView = ({ weekDays, shifts, doctorsMap, specialtiesMap, allShiftsMap, onShiftClick, onDayClick, handleDrop, handleDragOver, handleDragLeave }) => {
    return (
        <div className="calendar-grid week-view">
            {weekDays.map(day => <div key={day.toString()} className="day-name">{capitalize(day.toLocaleString('es-ES', { weekday: 'short' }))} {day.getDate()}</div>)}
            {weekDays.map(day => {
                const dateStr = formatDate(day);
                return (
                    <div key={dateStr} className="day-cell" onClick={() => onDayClick('new', dateStr)} onDrop={(e) => handleDrop(e, dateStr)} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
                        <div className="shifts-in-day">
                           {shifts.filter(shift => shift.date === dateStr).map(shift => {
                                const doctor = doctorsMap.get(shift.doctorId);
                                const specialty = doctor ? specialtiesMap.get(doctor.specialty) : null;
                                const shiftInfo = allShiftsMap.get(shift.time);
                                if (!shiftInfo) return null;
                                return (
                                    <div key={shift.id} className={`shift-item ${shift.time === 'Vacation' ? 'vacation-item' : ''}`} style={{ backgroundColor: specialty?.color || '#ccc' }} title={`${doctor?.name} (${doctor?.specialty}) - ${shiftInfo.name}`} onClick={(e) => { e.stopPropagation(); onShiftClick(shift); }}>
                                        <span className="shift-time-indicator">{shiftInfo.abbreviation}</span>
                                        <div className="shift-details"><div className="shift-doctor-name">{doctor?.name}</div><div className="shift-doctor-specialty">{doctor?.specialty}</div></div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )
            })}
        </div>
    );
};

const DayView = ({ date, shifts, doctorsMap, specialtiesMap, allShiftsMap, onShiftClick, onDayClick, handleDrop, handleDragOver, handleDragLeave }) => {
    const dayShifts = shifts.filter(s => {
        if (s.date !== date) return false;
        const shiftInfo = allShiftsMap.get(s.time);
        return shiftInfo && shiftInfo.startTime && !shiftInfo.startTime.startsWith('19') && !shiftInfo.startTime.startsWith('2'); // simple day check
    });
    const nightShifts = shifts.filter(s => {
        if (s.date !== date) return false;
        const shiftInfo = allShiftsMap.get(s.time);
        return shiftInfo && shiftInfo.startTime && (shiftInfo.startTime.startsWith('19') || shiftInfo.startTime.startsWith('2')); // simple night check
    });
    const vacationShifts = shifts.filter(s => s.date === date && s.time === 'Vacation');

    if (vacationShifts.length > 0) {
        return (
            <div className="calendar-grid day-view">
                <div
                    className="day-view-vacation-overlay"
                    onDrop={(e) => handleDrop(e, date, 'Vacation')}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => onDayClick('new', date, undefined, 'Vacation')}
                >
                    <h3>En Vacaciones</h3>
                    {vacationShifts.map(shift => {
                        const doctor = doctorsMap.get(shift.doctorId);
                        return (
                            <div key={shift.id} className="shift-item vacation-item" style={{ backgroundColor: '#64748b' }} onClick={(e) => { e.stopPropagation(); onShiftClick(shift); }}>
                                <div className="shift-details">
                                    <div className="shift-doctor-name">{doctor?.name}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    const renderShiftSlot = (defaultTime: ShiftTime, label: string, relevantShifts: Shift[]) => (
        <div className="day-view-slot" onDrop={(e) => handleDrop(e, date, defaultTime)} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onClick={() => relevantShifts.length === 0 && onDayClick('new', date, undefined, defaultTime)}>
            <div className="day-view-time">{label}</div>
            <div className="day-view-shifts-container">
                {relevantShifts.length > 0 ? (relevantShifts.map(shift => {
                    const doctor = doctorsMap.get(shift.doctorId);
                    const specialty = doctor ? specialtiesMap.get(doctor.specialty) : null;
                    const shiftInfo = allShiftsMap.get(shift.time);
                    return (
                        <div key={shift.id} className="shift-item" style={{ backgroundColor: specialty?.color || '#ccc' }} title={`${doctor?.name} - ${doctor?.specialty}`} onClick={(e) => { e.stopPropagation(); onShiftClick(shift); }}>
                            {doctor?.name}<small>{shiftInfo?.name || shift.time}</small>
                        </div>
                    );
                })) : (<div className="empty-shift-slot" onClick={() => onDayClick('new', date, undefined, defaultTime)}><span>Turno Libre</span></div>)}
            </div>
        </div>
    );
    return (
        <div className="calendar-grid day-view">
            {renderShiftSlot('DayGuard', 'Turno Diurno', dayShifts)}
            {renderShiftSlot('NightGuard', 'Turno Nocturno', nightShifts)}
        </div>
    );
};

const container = document.getElementById('root');
if(container) {
    const root = createRoot(container);
    root.render(<App />);
}