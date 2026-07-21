using Microsoft.EntityFrameworkCore;

namespace ErDFixture;

public class SchoolContext : DbContext
{
    public DbSet<Student> Students { get; set; } = null!;
    public DbSet<Instructor> Instructors { get; set; } = null!;
    public DbSet<Department> Departments { get; set; } = null!;
    public DbSet<Course> Courses { get; set; } = null!;
    public DbSet<Enrollment> Enrollments { get; set; } = null!;
    public DbSet<CourseAssignment> CourseAssignments { get; set; } = null!;
    public DbSet<OfficeAssignment> OfficeAssignments { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Instructor>()
            .HasOne(instructor => instructor.OfficeAssignment)
            .WithOne(office => office.Instructor)
            .HasForeignKey<OfficeAssignment>(office => office.InstructorID);

        modelBuilder.Entity<Department>()
            .HasOne(department => department.Administrator)
            .WithMany()
            .HasForeignKey(department => department.InstructorID)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<CourseAssignment>()
            .HasKey(assignment => new { assignment.CourseID, assignment.InstructorID });
    }
}
